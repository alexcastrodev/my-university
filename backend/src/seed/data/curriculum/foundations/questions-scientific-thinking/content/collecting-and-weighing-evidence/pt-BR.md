---
version: 1.0
updatedAt: 2026-09-06
title: Coletando e Ponderando Evidência
summary: A força de uma evidência é medida por quão surpreendente seria se a hipótese fosse falsa, não por se é consistente com ela; um resultado discriminador único pode superar uma pilha de resultados fracos e não discriminadores, e atualizações devem ser incrementais.
---
## Objetivos de Aprendizagem

- Explicar por que a força da evidência para uma hipótese depende de quão surpreendente essa evidência seria se a hipótese fosse falsa, não meramente de se é consistente com a hipótese.
- Distinguir evidência que é meramente consistente com uma hipótese de evidência que de fato a discrimina de uma alternativa plausível.
- Conectar esse raciocínio informal à lógica formal que um valor-p codifica, sem precisar do maquinário estatístico completo para raciocinar corretamente no dia a dia.
- Ponderar um único resultado surpreendente contra um corpo maior de resultados mais fracos e menos surpreendentes.
- Identificar formas comuns pelas quais as pessoas julgam mal quanto um dado pedaço de evidência deveria mudar sua confiança.

## Contexto e Motivação

Uma vez que uma hipótese foi testada, um experimento mínimo rodado, variáveis apropriadamente isoladas e controladas, um resultado volta. A habilidade restante, fácil de subestimar, é descobrir o quanto esse resultado deveria de fato mudar o que você acredita. Nem todo resultado que é *consistente com* uma hipótese é evidência forte para ela, e nem todo resultado que a *contradiz* é uma refutação decisiva; a pergunta certa a fazer de qualquer pedaço único de evidência não é "isso se encaixa na minha hipótese?" mas "quão surpreendente seria esse resultado específico se minha hipótese de fato fosse falsa?" Um resultado que seria quase igualmente provável seja a hipótese verdadeira ou falsa mal move o ponteiro, não importa quão perfeitamente pareça confirmar a história. Um resultado que seria muito improvável se a hipótese fosse falsa, mas é exatamente o que a hipótese prevê, é evidência forte, porque sua ocorrência é difícil de explicar de qualquer outra forma.

Esta é precisamente a lógica que um **valor-p** formaliza, coberta em rigor estatístico completo em *Teste de Hipóteses e Valores-p* (na trilha de probabilidade e estatística): um valor-p é, aproximadamente, a probabilidade de observar um resultado pelo menos tão extremo quanto o de fato visto, *se* a hipótese nula (a alternativa de "nada interessante está acontecendo") fosse verdadeira. Um valor-p pequeno significa que o resultado observado teria sido surpreendente sob a nula, que é exatamente "quão surpreendente isso seria se minha hipótese [de que algo real está acontecendo] fosse falsa" transformado em um número específico e calculável. Este conceito não é um substituto para aquele maquinário formal, e não o rederiva, seu trabalho é conectar o aparato formal de volta ao julgamento cotidiano e informal que todo mundo de fato precisa fazer constantemente, frequentemente sem nenhum teste formal em mãos: ler um único resultado de benchmark, uma única reclamação de usuário, uma única semana de métricas, e perguntar honestamente quanto isso deveria de fato mudar sua confiança, em uma direção ou outra.

## Teoria Central

### A pergunta central: surpreendente sob qual alternativa?

Evidência é forte exatamente na medida em que seria improvável de ocorrer se a hipótese fosse falsa, este é o coração informal do que um teste de significância formal mede precisamente. Concretamente: se uma hipótese prevê o resultado A, e o resultado A é *também* o que seria esperado sob a maioria das explicações alternativas plausíveis, então observar A mal distingue a hipótese dessas alternativas, é evidência fraca, por mais confortavelmente que "se encaixe." Se em vez disso o resultado A seria genuinamente improvável sob qualquer explicação alternativa que alguém tenha proposto, e a hipótese especificamente o prevê, então observar A é evidência forte, precisamente porque não há uma história concorrente fácil para por que aconteceu. Isso reformula "a evidência apoia a hipótese" na mais afiada "a evidência discrimina a hipótese de suas alternativas ativas", a mesma formulação de discriminação-primeiro que governa como um experimento mínimo é projetado em primeiro lugar (*Projetando um Experimento Mínimo*), agora aplicada a interpretar qualquer resultado que de fato voltou.

### Confirmação fraca vs. discriminação genuína

Um padrão clássico de confirmação fraca: uma hipótese prevê "o desempenho vai melhorar," uma mudança é feita, e o desempenho de fato melhora, tomado como evidência confirmadora. Mas se o desempenho tende a melhorar ligeiramente na maioria dos deploys independentemente de seu conteúdo (devido a melhorias graduais de infraestrutura, aquecimento de cache ao longo do tempo, ou simples ruído de medição tendendo em uma direção naquela semana), então "o desempenho melhorou" era provável de acontecer independentemente de essa mudança específica ter algum efeito real, não discrimina a hipótese da alternativa "isso não teve efeito e o desempenho teria melhorado de qualquer forma." Um resultado genuinamente discriminador seria um que a explicação alternativa *não* prevê, digamos, uma melhoria específica e precisamente dimensionada que corresponde a um cálculo teórico do efeito esperado da mudança, de uma magnitude grande demais para ser explicada por deriva ordinária semana a semana. O tamanho e a especificidade de uma correspondência com a previsão de uma hipótese, não apenas sua direção, frequentemente é o que separa confirmação fraca de discriminação real.

### Um resultado marcante vs. muitos fracos

Ponderar evidência também significa comparar entre pedaços de evidência que diferem enormemente em força, e um erro comum é tratar quantidade como substituto de qualidade. Dez pontos de dados que são cada um individualmente compatíveis tanto com a hipótese quanto com sua alternativa não se somam a evidência forte apenas porque há dez deles, se nenhum dos dez de fato discrimina entre as duas, a fraqueza de cada um não desaparece através de repetição; pode, em algumas situações, se acumular (mais chances de um parecer de apoio por acaso), mas não fica mais forte. Em contraste, um único resultado que seria altamente improvável sob a alternativa, um único benchmark que cai exatamente onde um modelo teórico específico previu, com uma precisão improvável de surgir por acaso, pode superar uma pilha muito maior de observações ambíguas e não discriminadoras. Isso se conecta diretamente à lógica do valor-p: um valor-p é calculado a partir de um resultado observado específico (ou um pelo menos tão extremo) contra uma hipótese nula específica, e um valor-p muito pequeno reflete exatamente essa situação, um resultado que teria sido bastante improvável se nada de interessante de fato estivesse acontecendo.

### Atualizando incrementalmente, não tudo-ou-nada

Ponderar evidência bem também significa tratar cada novo resultado como uma atualização da confiança existente, não como um veredito isolado considerado sem relação a tudo já conhecido. Um resultado surpreendente que seria evidência forte sozinho carrega um pouco menos de peso se contradiz um corpo grande e cuidadosamente coletado de evidência prévia apontando na outra direção, não porque o novo resultado deveria ser descartado, mas porque "essa nova medição em si está equivocada ou incomum" agora é uma explicação alternativa ativa que tem que ser ponderada contra "todo o corpo de evidência anterior estava errado." Bom peso de evidência mantém controle disso explicitamente, perguntando não apenas "este novo resultado é surpreendente sob minha hipótese ser falsa" mas também "como isso se encaixa com, ou contra, a evidência acumulada que eu já tenho."

## Exemplos Resolvidos

### Exemplo 1 — um resultado de benchmark, evidência fraca vs. forte comparadas

**Configuração.** Hipótese: um novo índice de banco de dados reduz a latência de consulta para um padrão de consulta lenta específico. Alternativa: o índice não faz diferença real, e qualquer melhoria medida se deve a efeitos de cache ou ruído de medição ordinário.

**Evidência fraca.** Uma única execução mostra a consulta completando 8% mais rápido com o índice em vigor. A cronometragem de consulta nesse sistema é conhecida por variar aproximadamente ±10% de execução para execução devido a estado de cache e carga de fundo, uma melhoria de 8% está bem dentro da faixa que seria esperada mesmo sob a alternativa de "sem efeito real." Esse resultado é próximo de igualmente provável seja a hipótese verdadeira ou falsa; mal discrimina entre elas, por mais que pareça confirmação na superfície.

**Evidência forte.** Em vez disso, trinta execuções intercaladas (alternando consultas indexadas e não indexadas, controlando por estado de cache como no conceito anterior de controles) mostram uma redução de latência consistente e reproduzível de 60% com o índice, bem fora da banda de ruído execução-para-execução observada. Uma melhoria de 60%, tão consistentemente, seria bastante improvável se o índice não tivesse efeito real e os ganhos anteriores fossem apenas ruído, esse padrão específico de resultados é muito mais provável sob a hipótese do que sob a alternativa, que é exatamente a propriedade que a torna evidência forte. Em termos de valor-p, este segundo cenário é o tipo de resultado que corresponderia a um valor-p pequeno contra a nula de "sem efeito", um resultado que raramente surgiria por acaso sozinho.

**A lição.** A figura única de 8% e a figura de trinta execuções de 60% diferem enormemente em peso evidencial, mesmo que ambas sejam nominalmente "consistentes com" a hipótese de que o índice ajuda, apenas a segunda de fato discrimina a hipótese de sua alternativa declarada.

### Exemplo 2 — um único relatório de bug vs. um padrão acumulando

**Configuração.** Hipótese: uma mudança recente introduziu uma condição de corrida causando falhas intermitentes de requisição sob carga. Alternativa: as falhas são intermitência preexistente não relacionada no ambiente de teste.

**Ponderando o primeiro relatório.** Um usuário relata uma falha intermitente logo depois de a mudança ser lançada. Falhas intermitentes desse formato geral já eram ocasionalmente relatadas antes da mudança também, a uma taxa de fundo baixa, então a chegada de mais um desses relatórios não é, por si só, fortemente surpreendente sob a alternativa de "intermitência preexistente, não relacionada à mudança." É sugestivo, vale a pena investigar, mas evidência fraca sozinho.

**Ponderando um padrão acumulando.** Ao longo da semana seguinte, a taxa desses relatórios sobe para várias vezes a taxa de fundo pré-mudança, e, crucialmente, os relatórios agora se agrupam especificamente em torno do caminho de código exato que a mudança modificou, um padrão que a alternativa de "intermitência preexistente não relacionada" não dá nenhuma razão particular para esperar. Esse padrão (um improvável sob a alternativa, um provável sob a hipótese) é evidência forte, não porque qualquer relatório único seja dramático, mas porque o formato geral da evidência acumulada é difícil de explicar exceto pela hipótese.

**A lição.** A evidência não se tornou forte porque mais relatórios chegaram por si só, quantidade sozinha, como notado acima, não fabrica discriminação. Tornou-se forte porque o *padrão* dos relatórios acumulados (taxa e localização) era especificamente o que a hipótese previu e especificamente não o que a alternativa principal previu.

## Equívocos Comuns e Armadilhas

- **"Qualquer resultado consistente com minha hipótese é evidência para ela."** Consistência é necessária mas não suficiente, um resultado tem que ser mais provável sob a hipótese do que sob uma alternativa ativa para de fato contar como evidência para ela sobre essa alternativa. Um resultado igualmente provável de qualquer forma é evidencialmente neutro, por mais confortavelmente que se "encaixe" na história preferida.
- **"Mais pontos de dados sempre significa evidência mais forte."** Mais pontos de dados não discriminadores não se somam a evidência forte; o que importa é se cada pedaço adicional de evidência seria surpreendente sob a alternativa, não meramente quantos pedaços há. Um único resultado bem projetado e altamente discriminador pode superar uma pilha grande de fracos.
- **"Um resultado surpreendente que contradiz tudo que eu acreditava anteriormente deveria imediatamente derrubar essa crença."** Um único resultado novo tem que ser ponderado não apenas contra a hipótese sendo testada mas contra o corpo prévio de evidência já coletado, um resultado surpreendente isolado às vezes é melhor explicado por erro de medição ou um acaso incomum em vez de descartar completamente uma conclusão anterior bem apoiada, embora ainda deva provocar uma reverificação genuína em vez de dispensa.
- **"Um valor-p diz a você a probabilidade de a hipótese ser verdadeira."** Esta é uma leitura equivocada comum da ferramenta formal à qual este conceito se conecta informalmente, um valor-p é a probabilidade dos dados observados (ou mais extremos) dado a hipótese nula, não a probabilidade da hipótese dados os dados. O raciocínio informal neste conceito ("quão surpreendente isso seria se a hipótese fosse falsa") espelha a lógica real do valor-p; confundi-lo com "probabilidade de a hipótese ser verdadeira" erra tanto a versão informal quanto a formal da mesma forma.

## Resumo

A força de um pedaço de evidência não é medida por se ele se encaixa em uma hipótese, mas por quão surpreendente seria se a hipótese fosse falsa, um resultado que é igualmente provável sob uma alternativa plausível mal muda a confiança de forma alguma, por mais perfeitamente que pareça confirmar a história, enquanto um resultado que seria genuinamente improvável sob qualquer explicação concorrente é evidência forte precisamente porque é difícil de explicar. Esta é a mesma lógica que um valor-p formaliza exatamente, calculando a probabilidade de um resultado pelo menos tão extremo sob a hipótese nula; a habilidade informal que este conceito constrói é aplicar esse mesmo raciocínio de discriminação-primeiro no dia a dia, sem sempre rodar um teste formal, ponderando um único resultado marcante e difícil de explicar de outra forma contra uma pilha maior de mais fracos e não discriminadores, e atualizando a confiança existente incrementalmente em vez de tratar cada novo resultado como um veredito isolado e tudo-ou-nada.

## Documentation Links

- [Stanford Encyclopedia of Philosophy — Karl Popper](https://plato.stanford.edu/entries/popper/) — doc
- [Stanford Encyclopedia of Philosophy — Science and Pseudo-Science](https://plato.stanford.edu/entries/pseudo-science/) — doc
