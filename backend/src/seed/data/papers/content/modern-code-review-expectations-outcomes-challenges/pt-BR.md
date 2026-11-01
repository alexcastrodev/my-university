---
title: "Expectativas, resultados e desafios da revisão de código moderna"
summary: Um estudo de métodos mistos na Microsoft, com observação, entrevistas, uma pesquisa e a classificação de comentários de revisão, conclui que a revisão de código serve menos para achar defeitos do que os desenvolvedores esperam e mais para entender mudanças e compartilhar conhecimento.
researchArea: Engenharia de software
keywords: revisão de código, engenharia de software empírica, compreensão de programas, transferência de conhecimento, experiência do desenvolvedor, pesquisa qualitativa
version: 1.0
updatedAt: 2026-11-01
---

## Visão geral

A revisão de código, em que a mudança de um desenvolvedor é lida por outras pessoas antes de entrar no código principal, é prática comum na indústria e no código aberto. A forma antiga, a inspeção formal de código dos anos 1970, era uma reunião longa e síncrona, com processo rígido e boa evidência de que achava defeitos. A revisão moderna é informal, feita em uma ferramenta e parte do trabalho do dia a dia, e não está claro que a evidência antiga se aplique a ela.

Este artigo do ICSE 2013, de Alberto Bacchelli (Universidade de Lugano) e Christian Bird (Microsoft Research), pergunta o que desenvolvedores e gerentes esperam da revisão moderna, o que de fato obtêm dela e o que a torna difícil.

Vale conhecer antes: como é um pull request ou uma revisão de mudança em uma ferramenta, a ideia mais antiga de inspeção de código e os métodos básicos da pesquisa qualitativa (entrevistas, questionários, codificação de texto em categorias).

## Contribuição

- **Um estudo exploratório, sem hipóteses definidas de antemão,** na Microsoft, com times de produtos e culturas de revisão diferentes.
- **Uma comparação entre expectativas e resultados.** O artigo mostra que o principal motivo para revisar, achar defeitos, não é o que a revisão mais produz.
- **A compreensão como desafio central.** A maior dificuldade dos revisores é entender a mudança e o seu contexto, e muitos dos mecanismos que usam para isso não são apoiados pelas ferramentas de revisão.
- **Recomendações** para profissionais e implicações para pesquisadores e quem constrói ferramentas.

## Metodologia

O estudo triangula quatro fontes. Os autores observaram 17 desenvolvedores fazendo revisões, de 16 times de produto, e os entrevistaram de forma semiestruturada. Depois classificaram à mão 570 comentários de 200 threads da ferramenta de revisão CodeFlow, sorteados entre threads com pelo menos dois comentários, usando card sorting. Por fim, enviaram um questionário a 165 gerentes e 873 programadores.

Os temas surgiram das entrevistas por card sorting de 1.047 unidades coerentes, e as categorias foram revisadas por todos os pesquisadores. Um diagrama de afinidade agrupou as categorias nos temas principais.

## Resultados

Estes são os resultados relatados pelos autores.

- Achar defeitos é a principal motivação de desenvolvedores e gerentes, mas as "melhorias de código" (melhores práticas, remoção de código desnecessário, legibilidade) são os comentários mais frequentes, com 165 de 570 (29%). Os comentários sobre defeitos são só 78 (14%), a quarta categoria mais frequente entre nove, e a maioria trata de pequenos problemas lógicos, como casos de borda.
- A revisão traz outros benefícios que as pessoas valorizam, entre eles transferência de conhecimento, consciência do time e transparência (por exemplo, incluir uma lista de e-mail como revisora opcional para que todos vejam a mudança), além de soluções alternativas.
- Entender é o desafio mais frequente nas entrevistas e a segunda categoria de comentário mais frequente nas revisões. Revisores que conhecem o código e o contexto terminam mais rápido e dão retorno mais valioso, e o questionário indica que achar defeitos é o resultado que exige o entendimento mais profundo.
- Os revisores descrevem revisões de baixo valor, centradas em formatação porque é fácil.
- Os autores recomendam não depender só da revisão para garantir qualidade, espalhar o conhecimento para que os autores tenham potenciais revisores, pedir que o autor dê contexto e oferecer formas de comunicação síncrona.

## Análise crítica

O estudo é valioso porque pergunta às pessoas o que elas fazem em vez de presumir. É qualitativo e de uma única empresa, e os autores dizem isso.

- **Uma empresa, uma ferramenta.** Os comentários vêm do CodeFlow e todos os times são da Microsoft. Os autores argumentam, com exemplos de outras áreas, que um estudo profundo de um só ambiente tem valor, e triangulam as fontes, mas os números específicos (como 14% de comentários sobre defeitos) não devem ser tomados como gerais.
- **Amostra codificada pequena.** Os 570 comentários vêm de 200 threads. Os autores discutem se isso explica a baixa fatia de defeitos e concluem, pelas entrevistas e pelo questionário, que não, mas as proporções vêm de uma amostra.
- **O que os comentários revelam é limitado.** Consciência e aprendizado são difíceis de enxergar nos rastros de uma revisão, então a evidência para eles vem do que as pessoas dizem, que é um tipo de evidência mais fraco que o comportamento.
- **A prática mudou.** Desde 2013, as ferramentas e a automação de revisão evoluíram, e parte dos comentários de baixo nível encontrados no artigo hoje é pega por linters e bots. Os achados sobre entendimento são provavelmente a parte que melhor envelheceu, e isso é um julgamento nosso.
- **As expectativas são autorrelatadas,** e as pessoas podem declarar a busca por defeitos como motivo oficial mais do que ela de fato é o motivo real.

## Pesquisas futuras

- Ferramentas que apoiem o entendimento: resumos do motivo de uma mudança, melhor navegação pelo contexto e formas de mostrar o que é relevante.
- Estudos sobre como consciência e aprendizado de fato crescem ao participar de revisões.
- Automatizar as checagens de baixo nível, para que o tempo humano de revisão vá para questões de projeto e conceito.
- Replicação fora da Microsoft, no código aberto e em outras ferramentas e culturas de revisão.
