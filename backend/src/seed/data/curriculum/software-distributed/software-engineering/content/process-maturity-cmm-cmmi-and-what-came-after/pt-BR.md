---
version: 1.0
updatedAt: 2026-11-03
title: "Maturidade de Processo: CMM, CMMI e o Que Veio Depois"
summary: "Uma história curta do CMM e do CMMI: por que surgiram, o que os cinco níveis de maturidade diziam (e o que não diziam), quem é dono do CMMI hoje e o que a prática da indústria acrescentou. Tratado como livro versus hoje, nunca como prática atual."
---
## Objetivos de Aprendizagem

- Contar a história do Software CMM com precisão: quem o começou, por quê e como um arcabouço de maturidade e seu questionário se desenvolveram até um modelo de cinco níveis.
- Nomear os cinco níveis do CMM e dizer o que o modelo deliberadamente não afirmava.
- Dizer quem é dono do CMMI hoje e como ele mudou de mãos.
- Explicar o que uma classificação de maturidade diz e o que não diz sobre um produto.

## Contexto e Motivação

`software-process-models-waterfall-and-its-real-history` mostrou que o vocabulário inicial de processo veio de organizações que redigiam contratos, definiam marcos e aprovavam fases. Esta lição cobre a outra metade dessa história: como essas organizações decidiam em quem confiar um contrato. A resposta a que o SEI chegou a partir de 1986 foi medir o processo do contratado, num arcabouço que também visava ajudar as organizações a melhorá-lo. O resultado foi o Capability Maturity Model (CMM) e, depois, a família CMMI.

Esta é uma lição histórica, tratada como "livro versus hoje". Os modelos de maturidade ainda existem e ainda são vendidos, então não estão mortos. Mas muitos livros apresentam os cinco níveis como a forma de avaliar organizações profissionais de software, o que é um retrato dos anos 1990 e não um relato medido da prática atual. Esta lição traz o que o modelo dizia, quem o mantém hoje e o que se pode ou não concluir disso.

A lição anterior, `the-iso-iec-25010-quality-model`, descreveu a qualidade de um produto. Um modelo de maturidade descreve a organização que o produz. A introdução da edição de 2023 da 25010 observa que as normas SQuaRE de produto podem ser usadas junto com a família ISO/IEC 33000, de avaliação de processo de software: uma família descreve o produto, a outra avalia o processo. Qualidade de processo e qualidade de produto são relacionadas, não idênticas, e essa lacuna é toda a controvérsia.

## Teoria Central

### Origens: um problema do governo e um questionário

A fonte primária é o relatório do SEI CMU/SEI-93-TR-024, Capability Maturity Model for Software, Version 1.1 (Paulk, Curtis, Chrissis, Weber, fevereiro de 1993). O prefácio diz que, em novembro de 1986, o Software Engineering Institute, com ajuda da Mitre Corporation, começou a desenvolver um arcabouço de maturidade de processo que ajudaria as organizações a melhorar seu processo de software. O esforço foi iniciado em resposta a um pedido para dar ao governo federal um método de avaliar a capacidade de seus contratados de software. Em setembro de 1987 o SEI divulgou uma breve descrição do arcabouço e um questionário de maturidade, uma ferramenta simples para identificar áreas em que o processo de uma organização precisava melhorar.

O relatório é franco sobre o que deu errado: o questionário "foi tratado com frequência demais como 'o modelo' em vez de um veículo para explorar questões de maturidade de processo". Após quatro anos de experiência com o arcabouço e com o questionário preliminar, o SEI evoluiu o arcabouço para o CMM. A versão 1.0 saiu em agosto de 1991 e a 1.1, a que a maioria dos livros descreve, em fevereiro de 1993.

O relatório também dá a linhagem. A grade de maturidade da gestão da qualidade de Philip Crosby (*Quality Is Free*, 1979) inspirou a ideia de estágios de maturidade. Ron Radice e colegas, sob a direção de Watts Humphrey na IBM, a adaptaram para software. Humphrey levou o arcabouço ao SEI em 1986 e acrescentou os níveis de maturidade. Ele foi o primeiro diretor do Software Process Program do SEI.

### Os cinco níveis

```text
Nível 1  Initial     ad hoc, às vezes caótico; o sucesso depende do
                     esforço individual
Nível 2  Repeatable  gestão básica de projeto acompanha custo, prazo e
                     funcionalidade; sucessos anteriores podem se repetir
Nível 3  Defined     um processo padrão documentado para a organização
                     toda, adaptado por cada projeto
Nível 4  Managed     medidas detalhadas de processo e de qualidade do
                     produto são coletadas e controladas quantitativamente
Nível 5  Optimizing  melhoria contínua guiada por feedback quantitativo e
                     por inovações pilotadas
```

Os níveis 2 a 5 se decompõem em áreas-chave de processo. Contando a figura do relatório, o nível 2 tem seis (incluindo gestão de requisitos, planejamento de projeto, garantia de qualidade e gerência de configuração), o nível 3 tem sete, o nível 4 tem duas e o nível 5 tem três: 18 no total. O nível 1 não tem nenhuma, pois é definido pela ausência de um processo estável.

### O que o modelo dizia sobre si mesmo

Várias afirmações do relatório contrariam o resumo usual:

- Ele é "não prescritivo; não diz a uma organização como melhorar".
- Organizações de nível 1 "frequentemente desenvolvem produtos que funcionam, mesmo que estourem orçamento e prazo". A queixa é imprevisibilidade e dependência de heróis, não fracasso garantido.
- O modelo foi escrito pensando em "uma grande organização contratada" e exige julgamento profissional quando o ambiente de negócio difere de forma significativa.
- Passar do nível 1 para o 2 pode levar "vários anos"; passar entre os demais costuma levar "algo em torno de dois anos".

### Do CMM ao CMMI, e quem é o dono

Estes fatos vêm da página da empresa do CMMI Institute e do anúncio de 2023 da ISACA. O SEI lançou a primeira versão do CMM em 1991. A Carnegie Mellon fundou o CMMI Institute em 2012, e em 2016 a ISACA, uma associação profissional sem fins lucrativos, o adquiriu. O CMMI V2.0 foi lançado em 2018. A ISACA anunciou o V3.0 em abril de 2023, descrevendo-o como uma extensão além de desenvolvimento de produto, operação de serviços e gestão de fornecedores, rumo a segurança, safety, gestão de dados, gestão de pessoas e gestão de força de trabalho virtual, em oito domínios, e traçando as raízes do CMMI até o Software CMM. Portanto, hoje o CMMI é um produto da ISACA, não do SEI.

O Software CMM original foi sucedido pelo CMMI. Resumos secundários dão os nomes dos níveis do CMMI em representação por estágios como Initial, Managed, Defined, Quantitatively Managed e Optimizing, que diferem dos nomes de 1993; confira a documentação atual do modelo antes de depender deles.

### O que a indústria acrescentou, e os limites dessa afirmação

Três desenvolvimentos documentados convivem com os modelos de maturidade. O Manifesto Ágil (2001) declara preferência por "indivíduos e interações mais que processos e ferramentas" e por "software em funcionamento mais que documentação abrangente". O SEI publicou "CMMI or Agile: Why Not Embrace Both!" (2008), propondo usar os dois. E o programa de pesquisa DORA, conduzido pelo Google Cloud, mede a entrega por resultados observáveis, tema da próxima lição.

O quanto o CMMI é usado hoje é uma questão empírica separada, que esta lição não responde. A afirmação documentada é mais estreita: o CMM nasceu de um arcabouço pensado tanto para ajudar organizações a melhorar seu processo quanto para permitir ao governo avaliar contratados por ele, boa parte da prática de software de produto desde então também olhou para resultados visíveis no pipeline de entrega, e as classificações por avaliação continuam em uso e em desenvolvimento ativo.

## Exemplos Resolvidos

### Exemplo 1: classificando quatro organizações

1. "Todo projeto estima, acompanha o cronograma e baseline os requisitos, mas cada time faz do seu jeito." Nível 2: os controles existem, mas não há um processo padrão organizacional único.
2. "Existe um processo organizacional documentado e os projetos o adaptam com aprovação." Nível 3.
3. "A entrega depende de dois engenheiros seniores; quando um saiu, a release seguinte atrasou um trimestre." Nível 1, a dependência de indivíduos que o relatório nomeia.
4. "Coletamos dados de defeitos e esforço em todo projeto e usamos limites de controle para decidir quando um processo saiu do esperado." Nível 4.

Cada nível afirma algo sobre disciplina de processo. Nenhum diz se o produto é rápido, seguro ou agradável de usar.

### Exemplo 2: quanto dura uma escalada?

Se você ler os "vários anos" do relatório para ir do nível 1 ao 2 como três, e somar dois anos para cada um dos três passos seguintes, um script dá 3 + 2 + 2 + 2 = 9 anos do nível 1 ao 5. Isso ilustra a redação do relatório e não é um número medido, mas mostra por que tratar um nível como meta trimestral distorceria o que o nível pretendia representar.

### Exemplo 3: o que "somos CMMI nível 3" diz a um cliente

Um fornecedor diz ter sido avaliado no nível 3 de maturidade. É razoável inferir que a unidade avaliada tinha processos documentados e padronizados na época. Não é razoável inferir uma taxa de defeitos, uma frequência de deploy ou qualquer qualidade da 25010. Para isso, o cliente precisa de evidência de produto e de entrega, como os requisitos mensuráveis de `the-iso-iec-25010-quality-model` e as medidas de entrega da próxima lição.

## Equívocos Comuns e Armadilhas

- **"O CMM é como as organizações de software são avaliadas hoje."** Esse é o quadro dos livros. O CMMI é uma linha de produtos da ISACA, e o quadro dos livros não mede o quanto ele é usado.
- **"Nível mais alto significa software melhor."** O relatório diz que organizações de nível 1 muitas vezes entregam produtos que funcionam. Os níveis descrevem previsibilidade e disciplina de processo.
- **"O CMM diz como melhorar."** O relatório diz que ele não é prescritivo.
- **"O questionário é o modelo."** O SEI apontou isso como um erro inicial.
- **"O ágil substituiu o CMM."** O relatório do SEI de 2008 argumenta que os dois são compatíveis e propõe usar ambos. Nada do que é citado aqui documenta uma substituição formal; qualquer mudança de ênfase rumo a resultados de entrega é uma leitura das fontes acima, não algo que elas afirmem.

## Resumo

O Software CMM começou em 1986 no SEI como um arcabouço de maturidade de processo para ajudar organizações a melhorar seu processo de software, motivado por um pedido federal por um meio de avaliar contratados de software. O arcabouço, divulgado em 1987 com um questionário, foi evoluído para um modelo de cinco níveis (Initial, Repeatable, Defined, Managed, Optimizing) com 18 áreas-chave de processo, chegando à versão 1.1 em 1993, e descende da grade de maturidade de Crosby via Humphrey e IBM. Seus autores enfatizaram que ele não é prescritivo e que organizações de nível 1 podem entregar produtos que funcionam. O CMMI o sucedeu, passou a um CMMI Institute em 2012 e pertence à ISACA desde 2016, com o V3.0 anunciado em abril de 2023. Uma classificação de maturidade descreve disciplina de processo, não qualidade de produto. Valores ágeis e medidas de entrega baseadas em resultados cresceram ao lado dela, mas o quanto o CMMI é comum hoje é uma questão que esta lição deixa em aberto.

## Documentation Links

- [SEI: Capability Maturity Model for Software, Version 1.1 (CMU/SEI-93-TR-024)](https://resources.sei.cmu.edu/asset_files/TechnicalReport/1993_005_001_16211.pdf): a fonte primária para a origem, a linhagem, os cinco níveis, as 18 áreas-chave de processo e as afirmações que o modelo faz sobre si mesmo.
- [CMMI Institute: company history](https://cmmiinstitute.com/company): a linha do tempo do próprio dono, incluindo a primeira versão em 1991, o CMMI Institute em 2012, a aquisição pela ISACA em 2016 e o V2.0 em 2018.
- [ISACA: CMMI updates take performance improvements to the next level (2023)](https://www.isaca.org/resources/news-and-trends/isaca-now-blog/2023/cmmi-updates-take-performance-improvements-to-the-next-level): o anúncio do CMMI V3.0, seus oito domínios e o relato da ISACA sobre a história do modelo.
- [SEI: CMMI or Agile: Why Not Embrace Both! (2008)](https://www.sei.cmu.edu/library/cmmi-or-agile-why-not-embrace-both/): a nota do SEI que argumenta que CMMI e métodos ágeis podem ser usados juntos.
- [Agile Manifesto](https://agilemanifesto.org/): as quatro declarações de valor de 2001 citadas como a postura contrastante.
- [Wikipedia: Capability Maturity Model Integration](https://en.wikipedia.org/wiki/Capability_Maturity_Model_Integration): um resumo secundário da história do CMMI e dos nomes dos níveis por estágios, a conferir contra a documentação atual do modelo.
