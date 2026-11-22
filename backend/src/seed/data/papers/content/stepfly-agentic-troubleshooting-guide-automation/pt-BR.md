---
title: "StepFly: automação agêntica de guias de troubleshooting para diagnóstico de incidentes"
summary: O StepFly executa guias de troubleshooting com um agente de LLM. Extrai de cada guia, offline, um grafo de execução e modelos de consulta reutilizáveis, e depois executa o grafo online com um escalonador e executores que compartilham uma memória, rodando em paralelo os passos independentes. Em 15 guias e 80 incidentes, acerta cerca de 94% das vezes com o GPT-4.1.
researchArea: Engenharia de software
keywords: guias de troubleshooting, diagnóstico de incidentes, agentes de LLM, AIOps, DAG de execução, modelos de consulta, engenharia de confiabilidade de sites, execução paralela
version: 1.0
updatedAt: 2026-11-22
---

## Abstract

A gestão eficaz de incidentes em grandes sistemas de TI depende de guias de troubleshooting (TSGs), mas sua execução manual é lenta e sujeita a erros. Embora os avanços recentes em LLMs prometam automatizar tarefas de gestão de incidentes, as soluções existentes baseadas em LLM carecem de suporte especializado para vários desafios centrais, entre eles lidar com problemas de qualidade dos TSGs, interpretar fluxos de controle complexos, tratar consultas intensivas em dados e explorar o paralelismo de execução. Primeiro conduzimos um estudo empírico com 92 TSGs reais e, guiados pelos resultados, apresentamos o StepFly, um novo arcabouço agêntico de ponta a ponta para automação de guias de troubleshooting. Nossa abordagem tem um fluxo de três estágios: o primeiro oferece um guia abrangente, junto com uma ferramenta, o TSG Mentor, para ajudar engenheiros de confiabilidade de sites (SREs) a melhorar a qualidade dos TSGs; o segundo faz um pré-processamento offline com LLMs para extrair grafos acíclicos dirigidos (DAGs) de execução estruturados a partir de TSGs não estruturados e criar Plugins de Preparação de Consultas (QPPs) dedicados; e o terceiro executa online com um arcabouço escalonador-executor guiado pelo DAG, com um sistema de memória, para garantir o fluxo correto e permitir a execução paralela de passos independentes. Nossa avaliação empírica em um conjunto de TSGs e incidentes reais demonstra que o StepFly alcança cerca de 94% de taxa de sucesso com o GPT-4.1, superando as baselines com menos tempo e consumo de tokens. Além disso, obtém uma redução notável de 32,9% a 70,4% no tempo de execução para TSGs paralelizáveis. Nosso código e dados de exemplo estão disponíveis publicamente em https://github.com/microsoft/StepFly.

## Visão geral

Um guia de troubleshooting (TSG) é o documento que o engenheiro de plantão segue para uma classe de incidente: consultar este log, checar aquele deploy, comparar duas métricas, ramificar conforme o resultado. Segui-lo à mão sob pressão de tempo é lento e fácil de errar. O trabalho anterior [AutoTSG](/papers/autotsg-learning-and-synthesis-for-incident-troubleshooting) transformou guias em notebooks com classificadores e parsers sintetizados. O StepFly, da Microsoft e da Universidade Tsinghua, publicado nos Proceedings of the ACM on Software Engineering (FSE 2026), pergunta o que um agente de LLM consegue fazer com os mesmos guias.

O argumento dos autores é que agentes genéricos (eles testam ReAct e TaskWeaver) tratam o guia como documentação limpa, e ele não é. Os guias são longos, têm ramos e saídas antecipadas, trazem consultas grandes com parâmetros e são escritos como notas esparsas por especialistas. O StepFly, por isso, acrescenta estrutura em volta do modelo em vez de deixar o plano com ele.

## Contribuição

- **Um estudo empírico de 92 TSGs de 9 equipes**, com resultados sobre tamanho (a maioria com cerca de 3 mil tokens, de 5 a 15 passos, até 30), sobre a independência dos passos, sobre a fatia de modelos de consulta (cerca de 35,85% dos tokens em média) e sobre problemas de qualidade.
- **O TSG Mentor e um guia de escrita.** Uma ferramenta que classifica problemas de qualidade, reformata o TSG e dá sugestões em linha. O guia exige que os TSGs continuem legíveis para pessoas, não só para agentes.
- **Extração offline.** Um LLM extrai um DAG de execução de cada TSG (os nós são passos, as arestas carregam condições) e Plugins de Preparação de Consultas (QPPs), que guardam um modelo de consulta e preenchem seus parâmetros, de modo que o modelo não escreva consultas na hora. Os autores dos TSGs revisam o resultado.
- **Execução online.** Um escalonador percorre o DAG, marcando nós e arestas como desconhecidos, habilitados ou desabilitados. Os executores rodam os passos com plugins e um interpretador de código, com novas tentativas até um limite. Uma memória chave-valor guarda a saída das ferramentas, de modo que dados grandes circulem por referência e não pelo prompt.
- **Paralelismo.** Passos sem dependência rodam em vários executores ao mesmo tempo, como uma equipe de engenheiros dividiria o trabalho. A identificação de passos independentes foi feita com SREs, e automatizá-la fica para trabalho futuro.

## Metodologia

O estudo rotulou os problemas dos 92 TSGs linha a linha com quatro anotadores (dois pesquisadores, dois SREs), cada TSG revisado por dois deles, com kappa de Cohen de 0,78 e cerca de 12% dos itens precisando de um terceiro anotador. Os problemas caem em cinco grupos: Clareza e Precisão (37,4%), Instrução de Banco de Dados (27,2), Fluxo de Dados (20,4), Apresentação e Estrutura (9,9) e Fluxo de Controle (5,1).

A avaliação usa 15 TSGs muito usados, de 3 a 28 passos e 9 em média, e 80 incidentes reais de um sistema de produção da Microsoft. Os 15 guias foram antes revisados por SREs experientes seguindo as diretrizes de qualidade. Incidentes passados dão a verdade de referência. Uma execução só conta como sucesso se o caminho de execução e a conclusão diagnóstica baterem com o rótulo humano. Cada configuração rodou três vezes. Os modelos foram GPT-4.1, GPT-4.1-mini, GPT-4o e Grok-3.

## Resultados

- **Os TSGs são difíceis para agentes como estão escritos.** Muitos guias têm fluxo longo ou ramificado, consultas grandes e problemas de qualidade. O estudo encontra que quase metade dos TSGs tem oportunidades de execução paralela.
- **TSG Mentor.** Com leave-one-out sobre os 92 TSGs e três guias parecidos como exemplos, atinge revocação 0,78, precisão 0,85 e F1 0,81 em achar problemas (um acerto é a mesma categoria dentro de 5 linhas).
- **A extração é precisa.** Contra a verdade de referência corrigida por SREs, a extração de DAG obtém notas de nó acima de 99%, F1 de aresta de cerca de 93,47% e correspondência de condições de cerca de 91,78%. A extração de QPPs teve sucesso em 97,3% das vezes (251 extrações bem-sucedidas), e as falhas vieram do modelo.
- **Taxa de sucesso.** Com o GPT-4.1, o StepFly chega a 94,38%, contra 71,25 do ReAct e 80,0 do TaskWeaver, e a 84,38% com o GPT-4.1-mini. O ganho sobre a melhor das duas baselines vai de cerca de 8 pontos (Grok-3) a cerca de 20 (GPT-4o). A variante sem QPPs fica abaixo em 2,5 pontos (GPT-4.1) a 10,63 (GPT-4.1-mini). O ReAct muitas vezes parou no meio ou gerou consultas erradas, e o TaskWeaver muitas vezes executou passos errados.
- **Tempo e tokens.** O tempo mediano do StepFly é 88% do do ReAct e 38% do do TaskWeaver. O uso de tokens também é menor no StepFly.
- **Paralelismo.** Em 7 dos 15 TSGs que podem ser paralelizados, com 2 a 5 executores, o tempo cai entre 32,9% e 70,6% (o resumo diz 70,4; o texto dá 70,6 para um guia e 70,4 para outro), e a redução média com 5 executores é de 51,31%. Acrescentar executores além do paralelismo máximo do guia não adianta.
- **Implantação.** Um protótipo é acionado automaticamente por incidentes que chegam. Os autores relatam que ele roda centenas de vezes por semana para mais de 170 monitores de mais de 70 equipes e reduziu o tempo mediano de mitigação de incidentes em cerca de 34%. O texto que li não dá o método para esse número.

## Análise crítica

O sistema é construído com cuidado, e o projeto (um grafo que restringe o agente, modelos em vez de consultas geradas, memória em vez de encher o prompt) ataca as falhas que as baselines mostram. A evidência tem limites que os autores em parte declaram nas ameaças à validade.

Os pontos abaixo são uma leitura minha do artigo, não afirmações dele.

- **A comparação é sobre guias revisados.** Os 15 TSGs foram reescritos por SREs para atender às diretrizes de qualidade do próprio StepFly antes da avaliação, e os DAGs e QPPs extraídos são revisados pelos autores. Os 94% são resultado de um pipeline com preparação humana, não de guias brutos, e o artigo não relata a acurácia nos não revisados.
- **As baselines recebem menos estrutura por projeto.** ReAct e TaskWeaver compartilham o prompt e os plugins, mas não o DAG, os QPPs nem a memória. A ablação sem QPPs é útil. Não há ablação do DAG nem da memória separadamente, então não fica claro qual parte carrega o ganho.
- **O sucesso é pontuado contra incidentes passados.** As resoluções dos incidentes eram conhecidas, então a execução é conferida contra um rótulo. Isso não mostra o comportamento diante de um incidente novo sem resposta registrada, que é quando o agente faz falta.
- **O número da implantação não tem método no texto.** Uma redução de 34% no tempo mediano de mitigação é uma afirmação forte. Sem controle ou descrição de antes e depois, deve ser lida como relato dos autores.
- **O agente é só de diagnóstico por escolha.** A discussão de segurança diz que a execução se concentra em passos somente de leitura (consultas, métricas, análise) e que SREs revisam as conclusões antes de qualquer mitigação. É um limite sensato, e também significa que o projeto ainda não trata de guias cujos passos mudam estado, a lacuna deixada pelo [AutoTSG](/papers/autotsg-learning-and-synthesis-for-incident-troubleshooting).

## Pesquisas futuras

- Avaliar em guias brutos, sem revisão, e medir quanto do ganho vem da etapa de qualidade.
- Fazer ablação separada do DAG e da memória, e testar o agente contra incidentes sem resposta conhecida.
- Automatizar a identificação de passos paralelizáveis, que os autores deixam para os SREs, e estudar o custo em tokens quando um ramo paralelo se mostra desnecessário.
- Estender do diagnóstico para uma remediação com salvaguardas, com aprovações para passos que mudam estado.
