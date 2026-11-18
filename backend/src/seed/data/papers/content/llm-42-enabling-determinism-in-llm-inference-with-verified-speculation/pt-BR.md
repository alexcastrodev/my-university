---
title: "LLM-42: habilitando determinismo na inferência de LLMs com especulação verificada"
summary: O LLM-42 torna a inferência de LLMs reproduzível sem kernels invariantes ao batch, decodificando pelo caminho rápido normal e reexecutando janelas de tokens com uma ordem de redução de formato fixo, confirmando os tokens que coincidem e desfazendo o resto, de modo que só pagam o custo as requisições que pedem determinismo.
researchArea: Sistemas para aprendizado de máquina
keywords: inferência de llms, determinismo, decodificação especulativa, invariância ao batch, kernels de gpu, ponto flutuante, sglang
version: 1.0
updatedAt: 2026-11-18
---

## Visão geral

O mesmo prompt pode dar saídas diferentes em execuções distintas de um servidor de LLM, mesmo com parâmetros de amostragem idênticos. A causa está no nível do sistema: a soma em ponto flutuante não é associativa, o batching dinâmico coloca a requisição ao lado de vizinhas diferentes a cada execução, e os kernels de GPU escolhem esquemas de redução diferentes conforme o tamanho do batch. Multiplicações de matrizes, atenção e normalização reduzem muitos valores, então um esquema diferente produz números ligeiramente diferentes, que podem trocar um token e, como a decodificação é autorregressiva, mudar tudo o que vem depois.

A resposta atual, adotada por SGLang e vLLM, é a computação invariante ao batch: todo kernel usa uma única estratégia de redução para todo token, seja qual for o batch. Este artigo do SOSP 2026, da Microsoft Research e da University of Washington, argumenta que isso é restritivo demais. Tira dos kernels otimizações como o split-K, exige uma pilha paralela de kernels mantida só para determinismo e transforma o determinismo num imposto global sobre toda requisição do batch.

Termos para não confundir: esquema de redução é a ordem em que as somas parciais são combinadas, split-K é uma técnica de GEMM que divide a dimensão de redução entre blocos de threads, kernel invariante ao batch dá a mesma saída para uma entrada seja qual for o batch em que ela esteja, e kernel invariante à posição dá a mesma saída para uma entrada seja qual for sua posição num batch de mesmo tamanho total.

Vale conhecer antes: as fases de prefill e decode da inferência de LLMs, o continuous batching, o cache KV e a decodificação especulativa (um caminho rápido propõe vários tokens e um verificador os confere). O cache KV é o tema do [PagedAttention](/papers/pagedattention-memory-management-for-llm-serving), o artigo por trás do vLLM, que este artigo cita nos trabalhos relacionados e que, como o SGLang, adotou o modo invariante ao batch. Esse pareamento é meu.

## Contribuição

- **Quatro observações.** O1: enquanto uma sequência está num estado consistente, o próximo token costuma ser o mesmo entre execuções, e a divergência vem do primeiro token trocado sendo amplificado pela decodificação. O2: a maioria dos kernels de GPU usa reduções consistentes com o formato da entrada, a mesma estratégia para toda entrada de um dado formato. O3: o determinismo só exige que cada posição de token veja a mesma estratégia de redução entre execuções, não a mesma estratégia para todas as posições. O4: implantações reais precisam de determinismo para tarefas específicas (avaliação, auditoria, integração contínua), enquanto cargas criativas se beneficiam da variabilidade.
- **Decode-verify-rollback (DVR).** Os tokens saem do caminho rápido normal, com batching dinâmico. Periodicamente um verificador reexecuta uma janela de tamanho fixo dos tokens recentes numa passada separada. Como o formato da entrada é fixo, a reexecução segue uma ordem de redução consistente e serve de referência. Se todos os tokens coincidem, todos são confirmados, mais um token novo produzido pelo verificador. Se um difere, só os tokens até a última coincidência são confirmados, junto com o próximo token do verificador, e o resto é recalculado. Os tokens só chegam ao usuário depois de verificados.
- **Reparo do cache KV.** O verificador sobrescreve as entradas do cache KV gravadas durante a decodificação rápida pelas suas, para que os passos seguintes partam de um estado consistente. Cada passada de verificação confirma pelo menos um token, então há progresso garantido mesmo que todo token especulado fosse rejeitado.
- **Prefill resolvido por construção.** O prefill é tornado determinístico ao não agrupar seus tokens de forma arbitrária, então só os tokens do decode precisam de verificador. O preenchimento da janela com tokens fictícios cobre sequências que terminam no meio de uma janela.
- **Verificação agrupada.** Uma janela pequena é limitada por memória e cara por token, uma janela grande é barata por token mas recalcula mais num desacordo. O artigo verifica janelas pequenas e fixas de várias requisições numa só passada (por exemplo 8 requisições de 32 tokens), mantendo o custo de rollback de uma janela pequena e a utilização de um batch grande.
- **Determinismo seletivo.** Uma flag por requisição, `is_deterministic`, vale falso por padrão, então só as requisições marcadas pagam pela verificação. Os autores implementam o LLM-42 sobre o SGLang e reaproveitam seus kernels de GEMM, RMSNorm e MoE fundido, com FlashAttention-3 e um único split de KV no verificador, AllReduce baseado em multimem quando disponível e o amostrador com semente do SGLang (`multinomial_with_seed`).

## Metodologia

Primeiro mede-se o custo da linha de base. Kernels Triton invariantes ao batch são comparados com o cuBLAS na projeção de saída da rede feed-forward do Llama-3.1-8B-Instruct, três implementações de RMSNorm são comparadas, e depois vem um cenário de decode de ponta a ponta com 10 e 11 requisições. Para testar o O1, 350 requisições do ShareGPT rodam primeiro com batch de tamanho um para obter as saídas de referência, depois de novo com batching dinâmico a 6 consultas por segundo e 512 tokens de saída, e cada uma recebe nota pelo comprimento do primeiro e do segundo trecho consistente.

A avaliação usa o Llama-3.1-8B-Instruct numa máquina com quatro GPUs NVIDIA H100 PCIe (80 GB cada), SGLang 0.5.3rc0 e FlashAttention-3. A inferência offline roda 4096 requisições em cada uma de oito cargas: os conjuntos ArXiv e ShareGPT, mais seis pares sintéticos de comprimento de entrada e saída. A inferência online reproduz 4096 requisições do ShareGPT a 12 a 18 consultas por segundo e reporta latência de ponta a ponta e tempo até o primeiro token (TTFT). A fatia de requisições determinísticas é 2%, 5%, 10%, 20%, 50% ou 100%. As linhas de base são o SGLang em modo determinístico e em modo não determinístico, este como teto. Uma ablação varia a janela de verificação de 16 a 512 tokens e o número de requisições verificadas juntas de 1 a 32.

## Resultados

Estes são os resultados reportados pelos autores.

- **A invariância ao batch é cara.** O GEMM invariante ao batch chega a 194 TFLOPS contra 527 do cuBLAS (63% a menos), porque não usa split-K nem recursos mais novos do hardware. O RMSNorm em Python usado no SGLang é até 7 vezes mais lento que o kernel CUDA padrão, e o em Triton até 50% mais lento.
- **Uma requisição determinística atrasa todas.** Com 10 requisições não determinísticas o SGLang decodifica 845 tokens por segundo, e 931 com uma décima primeira. Se essa décima primeira é determinística, o batch inteiro passa pelos kernels lentos e a vazão cai 56%, para cerca de 415. O LLM-42 chega a 911 tokens por segundo no mesmo caso, 2,2 vezes o modo determinístico do SGLang e a 3% do não determinístico.
- **A divergência é tardia, depois rápida.** Com batching dinâmico muitas requisições coincidem com a referência por centenas de tokens iniciais, algumas por todos os 512, mas depois da primeira divergência o segundo trecho consistente fica perto de zero na maioria.
- **Vazão offline.** O modo determinístico do SGLang perde de 24% (in=2048, out=512) a 36% (ShareGPT). Com 100% de tráfego determinístico o LLM-42 ainda é mais rápido em todas as configurações menos uma, em que fica 6% mais lento (ShareGPT). No ArXiv ele fica a 8%, 2%, 1% e 1% do teto não determinístico com 5%, 10%, 20% e 50% de tráfego determinístico, até 41% mais rápido que o modo determinístico do SGLang, e 33% mais rápido no ShareGPT com 10% (até 48% numa configuração sintética).
- **Rollbacks são raros.** Mais da metade das requisições termina sem rollback. No pior caso (ArXiv, 100% determinístico) há 3351 rollbacks em 4096 requisições, menos de um por requisição, e a parcela recalculada chega a 10,97%. Algumas configurações não têm nenhum.
- **Latência online.** A 12 consultas por segundo o modo determinístico do SGLang tem latência mediana de 4,64 s e P99 de 28 s, contra 2,15 s e 13,2 s no não determinístico. A 18 são 10,6 s e 71,1 s contra 2,84 s e 17,4 s. O LLM-42 com 2% de tráfego determinístico tem mediana de 2,21 s a 12 consultas por segundo, 3% acima do teto, e com 100% de tráfego determinístico seu TTFT P90 a 18 consultas por segundo é de 101,2 ms contra 171,6 ms.
- **Ablação da janela.** Sem agrupamento, a latência P99 é de 615 s com janela de 16 tokens, 56,18 s com 128 e 99,94 s com 512. A verificação custa até 0,75 ms por token em janelas pequenas e 0,05 ms em 512, enquanto o recálculo sobe de 6,81% com 32 tokens para 46,41% com 256. A verificação agrupada leva as melhores configurações (256 tokens por passo em 4, 8 ou 16 requisições) a um P99 de 34 a 35 s.

## Análise crítica

O artigo declara vários limites por conta própria.

- **A verificação pausa todo mundo.** No protótipo uma passada de verificação paralisa todas as requisições em andamento, então mesmo o determinismo seletivo adiciona latência às demais, e o prefill não é agrupado. Com carga baixa e tráfego majoritariamente determinístico, o LLM-42 fica mais lento que o modo determinístico do SGLang.
- **Sem compartilhamento de prefixo.** Prefill e decode usam estratégias de redução diferentes, então o sistema não é invariante entre prefill e decode e não pode compartilhar caches de prefixo entre turnos ou requisições. Ele também não se combina com inferência baseada em decodificação especulativa.
- **Multi-GPU não medido.** A correção foi checada no Qwen-4B-Instruct-2507, no Qwen3-14B e no Qwen3-30B-A3B-Instruct-2507, com 1 a 4 GPUs e paralelismo de tensor, mas o desempenho só é reportado para um modelo, e a máquina de teste não tem multimem/NVLS.

Os pontos a seguir são uma leitura da evidência, não afirmações do artigo.

- **A garantia depende de uma suposição sobre os kernels.** O O2 diz que as reduções dependem só do formato da entrada, e o verificador é determinístico se isso vale. O artigo mostra quais operadores comuns têm a propriedade (a Tabela 2 marca o AllReduce em anel como nem invariante ao batch nem à posição) e fixa configurações de atenção e AllReduce, mas não dá prova nem teste de que um kernel novo ou uma versão nova de biblioteca preserve a propriedade. Determinismo aqui também significa entre execuções na mesma pilha, não entre tipos de GPU ou versões de software.
- **Um modelo, uma linha de base.** Vazão e latência vêm do Llama-3.1-8B numa H100 e são comparadas só com o modo invariante ao batch do SGLang. O modo do vLLM e kernels invariantes ao batch mais rápidos não são medidos, e os próprios autores notam que os kernels Triton usados na comparação não têm split-K.
- **A mistura de tráfego é escolhida.** O resultado de que o custo acompanha a fatia determinística depende de uma implantação real ter uma fatia pequena. As proporções de 2% a 100% são a varredura dos autores, não uma mistura medida em produção, e todo o argumento se apoia no O4.
- **O recálculo online é maior que o offline.** O artigo relata acima de 6% online contra menos de 2% offline e atribui isso à variabilidade do tamanho do batch, o que sugere que uma carga de produção em rajadas fica mais perto dos números online.
- **Não é uma história de usuário de ponta a ponta.** Os tokens só são liberados depois da verificação, o que os atrasa, e o artigo reporta TTFT mas não a latência entre tokens nem o comportamento em streaming.

## Pesquisas futuras

- Tirar a verificação do caminho crítico, por exemplo confinando-a a um subconjunto de SMs da GPU ou adiando lotes de verificação atrás do prefill e do decode regulares, o que os autores citam.
- Fazer prefill e decode compartilharem uma só estratégia de redução para que caches de prefixo possam ser compartilhados, e combinar o DVR com inferência por decodificação especulativa.
- Medir o desempenho multi-GPU em hardware com AllReduce multimem e checar a garantia entre gerações de GPU e versões de biblioteca.
- Comparar com o vLLM e com kernels invariantes ao batch otimizados, e medir que fatia do tráfego real pede determinismo.
