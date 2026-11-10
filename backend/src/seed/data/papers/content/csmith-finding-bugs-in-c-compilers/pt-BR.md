---
title: "Encontrando e entendendo bugs em compiladores de C"
summary: O Csmith gera programas C aleatórios que evitam comportamento indefinido e compara o que vários compiladores fazem com eles, o que levou os autores a reportar mais de 325 bugs no GCC, no LLVM e em outros compiladores ao longo de três anos.
researchArea: Linguagens de programação
keywords: teste de compiladores, teste diferencial, fuzzing, comportamento indefinido, miscompilação, compcert
version: 1.0
updatedAt: 2026-11-01
---

## Visão geral

Um compilador deveria ser a única parte da cadeia de ferramentas que não precisa ser questionada. Quando ele produz código errado sem aviso, ninguém encontra o bug lendo o programa, e a causa é difícil de enxergar. Compiladores são testados principalmente com suítes fixas de programas, e os autores suspeitam que essas suítes deixam grandes áreas do compilador sem teste.

Este artigo do PLDI 2011, da Universidade de Utah, apresenta o Csmith, uma ferramenta que escreve programas C aleatórios, mas válidos, e relata o que aconteceu quando os autores a rodaram contra compiladores reais por três anos. A manchete é que todo compilador testado falhou com entradas válidas e também produziu código errado sem aviso, com um caso especial no meio de um compilador verificado, que o artigo discute em detalhe.

Vale conhecer antes: o que faz um compilador otimizador, o que é "comportamento indefinido" em C (overflow de inteiros com sinal, leitura de memória não inicializada) e a ideia de testar sem oráculo comparando implementações.

## Contribuição

- **Teste diferencial aleatório para C.** O Csmith gera um programa, um harness o compila com vários compiladores e níveis de otimização, executa os resultados e sinaliza um bug quando as saídas divergem. Não é preciso uma saída esperada.
- **Programas com um único significado.** O problema difícil é gerar programas que sejam expressivos (muitos recursos de C, ponteiros, structs, laços) e também livres dos 191 tipos de comportamento indefinido e independentes dos 52 tipos de comportamento não especificado do C99. Se um programa tivesse comportamento indefinido, uma diferença entre compiladores não provaria um bug. O Csmith combina análise estática durante a geração com verificações dinâmicas.
- **Um estudo empírico** dos bugs encontrados: quantos, em quais compiladores, com quais sintomas e em que parte do compilador.

## Metodologia

Os autores usaram a ferramenta de forma oportunista por três anos, reportando bugs às equipes dos compiladores. Também fizeram experimentos controlados: acompanhar a taxa de falhas e a de código errado em muitas versões do GCC e do LLVM, verificar quais bugs aparecem sem otimização, medir a cobertura de código dos compiladores quando programas aleatórios são somados às suítes de teste deles e comparar o Csmith com outros quatro geradores de programas aleatórios em uma execução de uma semana em máquinas idênticas.

Examinaram os bugs para classificá-los por sintoma e por fase do compilador, e testaram o CompCert, um compilador cujas passagens de otimização são verificadas em um assistente de provas, com cerca de seis anos-CPU de programas aleatórios.

## Resultados

Estes são os resultados relatados pelos autores.

- Mais de 325 bugs antes desconhecidos foram reportados, 79 contra o GCC e 202 contra o LLVM (cerca de 2% de todos os relatórios de bug do LLVM). A maioria foi corrigida, e 25 bugs do GCC foram marcados como P1, a prioridade máxima, que bloqueia releases.
- Tanto o GCC quanto o LLVM ficaram pelo menos três ordens de grandeza menos propensos a falhar com os programas gerados ao longo das versões testadas.
- O Csmith encontrou mais erros de falha distintos do que os outros quatro geradores em uma semana.
- Somar 10.000 programas do Csmith às suítes de teste do GCC e do LLVM quase não mudou a cobertura de linhas, funções ou ramos, o que os autores chamam de resultado negativo e acreditam mostrar que essas métricas são rasas demais para capturar o que os programas aleatórios exercitam.
- No CompCert não encontraram nenhum erro de código errado no middle-end verificado, algo que nenhum outro compilador testado podia afirmar. Encontraram seis bugs de código errado no front end não verificado, e mais dois por uma especificação incompleta das instruções do PowerPC. Depois desses relatos, o desenvolvedor do CompCert estendeu a parte verificada para cobrir promoções de inteiros e outras conversões implícitas.
- Bugs encontrados foram redescobertos de forma independente por desenvolvedores de aplicações, o que os autores tomam como sinal de que importam.
- Uma estimativa grosseira de custo coloca cada bug reportado abaixo de US$ 1.000 para ser encontrado.

## Análise crítica

O artigo mudou o teste de compiladores, e seu método foi muito copiado. Por isso vale notar o que ele mostra e o que não mostra.

- **Número de bugs não é importância de bugs.** Muitos bugs reportados estavam em combinações incomuns de recursos que a maioria dos programas nunca usa. Os autores respondem com evidência de que desenvolvedores reais redescobriram alguns, mas não conseguem dizer quanto software real foi prejudicado.
- **Um bom oráculo é limitado pelo gerador.** O Csmith só encontra bugs na parte de C que consegue gerar sem comportamento indefinido. Só encontra bugs que fazem compiladores divergir, então um bug comum a todos os compiladores, ou que dependa de comportamento indefinido, continua invisível.
- **O resultado de cobertura é estranho e não é explicado.** Encontrar centenas de bugs somando quase nenhuma cobertura significa que as métricas de cobertura dizem pouco aqui, e a explicação do artigo é um palpite.
- **Escolhas de relato.** Os autores deram preferência a compiladores de código aberto cujas equipes respondem rápido, o que ajuda as taxas de correção a parecerem boas. O estudo também mede uma ferramenta por quem a construiu.
- **Leitura do caso CompCert.** "Não consegue achar código errado" vale para o início de 2011, para o middle-end e para o ambiente testado. É forte evidência a favor da verificação e não uma prova para o compilador inteiro.

## Pesquisas futuras

- Geração de testes guiada pela estrutura do compilador (white-box), que os autores citam como promissora, mas difícil de combinar com o projeto do Csmith.
- Melhor redução de casos de teste, para que um relatório de bug seja pequeno o bastante para ser entendido.
- Teste para outras linguagens, níveis de otimização e alvos, e para a interação de compiladores com sanitizers e otimização em tempo de link.
- Um entendimento mais claro de quanto teste artefatos verificados como o CompCert e o seL4 tornam desnecessário.
