---
version: 1.0
updatedAt: 2026-09-06
title: Distinguindo uma Afirmação de uma Suposição
summary: Uma suposição é presumida mas não avaliada pelo teste; pela observação Duhem-Quine, um teste falhado refuta tecnicamente a hipótese-mais-suposições, não a hipótese sozinha, então diagnosticar uma falha exige verificar as suposições antes de culpar a hipótese.
---
## Objetivos de Aprendizagem

- Definir o que distingue uma hipótese (a afirmação sob teste) de uma suposição (o que é tomado como certo para que o teste possa rodar).
- Explicar, via a observação Duhem-Quine, por que um resultado de teste tecnicamente se pronuncia sobre a conjunção de uma hipótese e suas suposições, não a hipótese sozinha.
- Identificar as suposições escondidas embutidas em um design de teste concreto antes de rodá-lo.
- Diagnosticar, quando um teste "falha," se a hipótese foi de fato refutada ou se uma suposição foi violada em vez disso.
- Distinguir verificação legítima de suposição do resgate ad hoc de uma hipótese contra o qual a falsificabilidade alerta.

## Contexto e Motivação

O conceito anterior nesta trilha estabeleceu o critério de falsificabilidade de Popper: uma afirmação conta como científica na medida em que alguma observação concebível poderia mostrá-la falsa. Mas nenhum teste de uma hipótese jamais acontece em um vácuo. Testar "a lentidão é causada por realocação repetida no loop crítico" exige confiar que a cronometragem do profiler é precisa, que a carga de trabalho usada para disparar a lentidão é representativa da que motivou a pergunta, e que nada mais na máquina está disputando os mesmos núcleos de CPU durante a medição. Nenhuma dessas é a hipótese. Todas elas são silenciosamente exigidas para que o teste da hipótese signifique algo. Essas exigências de fundo são **suposições**: proposições tomadas como certas, não porque são certas, mas porque um teste precisa se apoiar em algo, e testar tudo ao mesmo tempo não é possível.

Essa distinção não é um refinamento filosófico; tem uma consequência lógica precisa, às vezes chamada de problema Duhem-Quine, que segue diretamente da discussão de falsificabilidade no conceito anterior. Quando o resultado de um experimento contradiz uma previsão, o que foi estritamente falsificado não é a hipótese isoladamente, é a conjunção da hipótese *e* toda suposição na qual o teste se apoiou. Se pré-dimensionar um buffer para eliminar chamadas repetidas de `resize()` falha em acelerar qualquer coisa, a lógica sozinha não diz se a hipótese de realocação estava errada ou se, digamos, o arcabouço de benchmark introduziu sua própria sobrecarga que engoliu o efeito sendo medido. Ambas são consistentes com o mesmo teste falhado. Descobrir qual de fato quebrou é uma habilidade distinta e necessária, tratar todo teste falhado como uma refutação automática da hipótese, sem primeiro verificar as suposições das quais o teste dependia, produz conclusões confiantes mas erradas.

O peso de acertar isso se conecta de volta à discussão de falsificabilidade de uma segunda forma. A crítica de Popper à pseudociência era dirigida a teorias resgatadas da refutação adicionando explicações depois do fato, sem limite fundamentado em quantos desses resgates poderiam ser inventados. Identificar legitimamente uma suposição quebrada não é o mesmo movimento, mas pode parecer idêntico visto de fora se feito descuidadamente, que é exatamente por que essa distinção merece ser traçada com cuidado em vez de invocada como uma desculpa conveniente sempre que uma hipótese falha.

## Teoria Central

### O que conta como afirmação, o que conta como suposição

Uma **afirmação** (hipótese) é o palpite específico e verificável que o teste existe para avaliar, é o que você está tentando aprender se é verdadeiro. Uma **suposição** é algo do qual o design do teste depende ser verdadeiro, mas que o teste não é projetado para avaliar; é pressuposta em vez de investigada. O teste de "adicionar uma camada de cache reduz o tempo de resposta mediano" pressupõe, entre outras coisas, que o gerador de carga emite um padrão de requisição consistente e comparável nas execuções com-cache e sem-cache, e que a instrumentação de cronometragem mede o que afirma medir. Nenhuma dessas é a afirmação sendo testada; ambas são condições das quais a validade do teste depende.

A linha não é sobre certeza, uma suposição pode ser bem justificada ou frágil, e de qualquer forma ela permanece uma suposição enquanto o teste não de fato a verificar. A linha é sobre *papel*: a afirmação é a coisa que este teste específico é projetado para colocar em risco; a suposição é tudo mais no qual o design do teste se apoia sem colocar em risco.

### A observação Duhem-Quine, aplicada a um único teste

Formalmente, um teste da hipótese H, rodado sob suposições A1, A2, …, An, produz uma previsão que segue de H **junto com** todas as Ai. Se a previsão falha, a lógica clássica (modus tollens) apenas licencia rejeitar a conjunção "H e A1 e A2 e … e An", ela não, por si só, diz qual conjunto culpar. Esta é a mesma estrutura lógica reconhecida na literatura de filosofia da ciência para a qual as entradas da Stanford Encyclopedia of Philosophy sobre Popper e sobre ciência e pseudociência ambas apontam ao discutir como suposições auxiliares podem proteger uma teoria de uma refutação limpa: um teste falhado é sempre, estritamente, evidência contra o pacote inteiro, e atribuir essa culpa especificamente à hipótese exige trabalho adicional, verificar as suposições independentemente, uma de cada vez, em vez de assumir por padrão que a hipótese é a parte que quebrou.

### Tornando suposições explícitas antes de testar

Porque suposições são fáceis de ignorar precisamente porque são tomadas como certas, a disciplina prática é escrevê-las antes de rodar o teste, não depois de ele falhar. Para uma dada hipótese, isso significa perguntar: o que o design deste teste exige ser verdadeiro, que o próprio teste não verifica? Categorias típicas que valem a pena nomear explicitamente:

- **Validade de instrumentação**, a ferramenta de medição (um profiler, um cronômetro, um pipeline de logging) de fato mede a quantidade sobre a qual a hipótese trata, com resolução adequada?
- **Estabilidade ambiental**, algo além da variável sob teste também está mudando entre as condições sendo comparadas (carga de fundo, aquecimento de cache, condições de rede)?
- **Representatividade**, a carga de trabalho ou entrada do teste se assemelha à situação sobre a qual a pergunta original de fato tratava, ou um substituto conveniente para ela?

Nenhuma dessa lista é exaustiva; o ponto do exercício não é produzir uma checklist mas converter suposições silenciosas e não examinadas em nomeadas que possam mais tarde ser verificadas independentemente se um resultado de teste for surpreendente.

### Diagnosticando um teste falhado: hipótese ou suposição?

Quando o resultado de um teste contradiz a previsão, a estrutura Duhem-Quine acima diz que o próximo passo correto não é imediatamente concluir que a hipótese é falsa, mas verificar as suposições das quais o teste dependia, começando pelas mais plausíveis de terem sido erradas ou menos verificadas anteriormente. Se toda suposição nomeada se confirma independentemente, a resolução do cronômetro é confirmada adequada por um teste de calibração separado, o ambiente é confirmado estável por monitoramento durante a execução, a carga de trabalho é confirmada representativa por comparação com tráfego de produção, então a previsão falhada pode ser atribuída à hipótese com muito mais confiança. Se em vez disso uma das suposições acaba tendo sido violada, a conclusão correta é que o teste não disse nada decisivo sobre a hipótese, ele precisa ser rerrodado uma vez que a suposição quebrada seja corrigida.

## Exemplos Resolvidos

### Exemplo 1 — o cache melhora o tempo de resposta?

**Hipótese:** "Adicionar um cache read-through na frente dessa chamada de banco de dados vai reduzir o tempo de resposta mediano sob carga normal."

**Suposições das quais o teste depende (tornadas explícitas de antemão):** (a) o cronômetro de requisição usado para medir o tempo de resposta captura o round trip completo, não apenas um intervalo parcial dele; (b) a carga usada nas execuções com-cache e sem-cache é gerada da mesma forma, então qualquer diferença não é um artefato de padrões de tráfego diferentes; (c) nenhum outro processo na máquina de teste está disputando recursos de CPU ou rede durante nenhuma das execuções.

**Resultado do teste:** o tempo de resposta mediano é essencialmente inalterado com o cache habilitado, a previsão falha.

**Conclusão ingênua:** "A hipótese é falsa; o cache não ajuda aqui."

**Diagnóstico correto:** verificando a suposição (a) primeiro (por ser a menos verificada anteriormente), acontece que o cronômetro envolve apenas a própria chamada de banco de dados, não o manipulador de requisição completo, e o manipulador completo estava, sem o conhecimento do testador, buscando os mesmos dados novamente mais tarde na requisição por uma razão não relacionada, um custo que o cache nunca tocou e o cronômetro nunca viu. Uma vez que o cronômetro é corrigido para medir o round trip completo, o cache mostra uma melhoria clara e mensurável. A hipótese nunca foi de fato testada pela primeira execução; uma suposição quebrada sobre o que o cronômetro media estava escondendo o efeito o tempo todo. O teste "falhado" refutou a suposição (a), não a hipótese de cache.

### Exemplo 2 — um teste A/B em uma mudança de UI

**Hipótese:** "O botão de checkout redesenhado aumenta a taxa de conclusão do fluxo de checkout."

**Suposições:** (a) usuários são atribuídos aleatória e independentemente à versão controle ou tratamento, então os dois grupos são comparáveis em todos os outros aspectos; (b) a métrica de taxa de conclusão conta o resultado de cada usuário real exatamente uma vez; (c) ambas as variantes recebem a mesma mistura de fontes de tráfego (orgânico, pago, referência) durante a janela do teste.

**Resultado do teste:** o grupo de tratamento mostra uma taxa de conclusão mais baixa que o controle, o oposto da direção prevista.

**Conclusão ingênua:** "O novo botão prejudica a conversão; a hipótese é refutada, e pior, está invertida."

**Diagnóstico correto:** uma auditoria da suposição (b) revela que um lote de tráfego de monitoramento automatizado, requisições de bot que nunca completam checkout por design, foi classificado erroneamente como usuários reais e aconteceu de ser roteado desproporcionalmente para o balde de tratamento por uma peculiaridade de cache na lógica de atribuição, violando também a suposição (a). Uma vez que o tráfego de bot é filtrado de ambos os grupos, a taxa de conclusão do grupo de tratamento é na verdade ligeiramente maior que o controle, consistente com a hipótese original. O teste como originalmente rodado refutou a conjunção da hipótese com uma suposição de randomização violada, não a hipótese sozinha.

### Exemplo 3 — um caso onde a hipótese de fato estava errada

**Hipótese:** "Trocar o algoritmo de ordenação da implementação atual para um radix sort especializado vai reduzir o tempo total de processamento para esse job em lote."

**Suposições:** (a) o tempo relatado pelo profiler atribui o custo corretamente à etapa de ordenação em vez de a I/O adjacente; (b) os dados de entrada usados no teste têm a mesma distribuição de chaves que os dados de produção; (c) a máquina rodando o teste tem disponibilidade de CPU consistente e não estrangulada ao longo da execução.

**Resultado do teste:** radix sort não mostra nenhuma melhoria, e isso se mantém depois de verificar separadamente, uma de cada vez, que a atribuição do profiler está correta (confirmado por um micro-benchmark direcionado isolando apenas a chamada de ordenação), que a distribuição de chaves dos dados de teste corresponde a um conjunto de dados de produção amostrado (confirmado comparando distribuições diretamente), e que estrangulamento de CPU não foi um fator (confirmado por monitoramento durante a execução, sem eventos de estrangulamento observados).

**Diagnóstico:** com todas as três suposições independentemente verificadas e se mantendo, a previsão falhada agora pode ser atribuída à própria hipótese com confiança razoável, neste caso, porque o tempo total do job em lote é genuinamente dominado por I/O em vez de ordenação, um fato que a atribuição correta do profiler (suposição a, verificada) de fato confirma diretamente. Este é o caso em que a abordagem ingênua nos Exemplos 1 e 2 acertaria por acidente mas pela razão errada: aqui, verificar as suposições ainda era o movimento certo, e é isso que transforma "o teste falhou" em uma refutação confiantemente atribuível da hipótese em vez de um palpite sortudo.

## Equívocos Comuns e Armadilhas

- **Tratar todo teste falhado como uma refutação automática da hipótese.** Como a observação Duhem-Quine deixa explícito, uma previsão falhada estritamente falsifica o pacote hipótese-e-suposições, não a hipótese sozinha, os Exemplos 1 e 2 mostram isso dando errado quando a suposição, não a hipótese, era o ponto real de falha.
- **Confundir verificação legítima de suposição com o resgate ad hoc contra o qual a falsificabilidade alerta.** Verificar uma suposição nomeada e previamente declarada independentemente, com seu próprio teste, e abandonar a hipótese se essa suposição acabar se mantendo, é fundamentado; inventar uma nova desculpa não testada apenas depois de um resultado inconveniente, sem forma independente de verificá-la, é o movimento ad hoc que Popper criticou nas teorias pseudocientíficas discutidas no conceito anterior. A diferença é a falsificabilidade do próprio resgate, a suposição foi especificada e verificável antes ou independentemente da falha, ou foi inventada unicamente para explicar a falha sem forma de verificá-la por conta própria?
- **Assumir que uma suposição não precisa de justificativa porque "é só uma suposição."** Uma suposição não está sendo testada por *este* experimento, mas isso não significa que esteja além de escrutínio inteiramente, tipicamente ela foi, ou poderia ser, verificada por algum outro meio (um teste de calibração, uma auditoria separada), que é precisamente o que os Exemplos 1 a 3 fazem para distinguir uma refutação genuína da hipótese de uma suposição quebrada.
- **Tentar questionar toda suposição toda vez, transformando todo teste em um regresso infinito.** Nem toda suposição vale igualmente a pena auditar em toda execução, suposições bem estabelecidas e previamente verificadas (uma biblioteca de cronômetro conhecida por ser precisa, um mecanismo de randomização já auditado em outro lugar) podem razoavelmente ser confiadas sem reverificar toda vez; a disciplina é nomear as suposições e priorizar verificar as mais prováveis de estarem erradas ou menos verificadas anteriormente, não relitigar todas indefinidamente.
- **Não distinguir uma suposição da hipótese em primeiro lugar.** Se suposições nunca são tornadas explícitas antes de um teste rodar, não há nada para verificar quando um resultado é surpreendente, e a tentação de simplesmente declarar a hipótese refutada (ou, pior, inventar uma desculpa infalsificável) se torna muito mais forte por padrão.

## Resumo

Uma suposição é uma proposição da qual o design de um teste depende mas que o próprio teste não avalia; uma hipótese (afirmação) é o palpite específico que o teste existe para colocar em risco. Porque a previsão de qualquer teste real segue da hipótese junto com suas suposições, uma previsão falhada estritamente falsifica apenas esse pacote inteiro, atribuir a falha especificamente à hipótese exige verificar independentemente as suposições primeiro, começando pelas menos verificadas, em vez de assumir por padrão que a hipótese foi a parte que quebrou. Nomear suposições explicitamente antes de um teste rodar, em vez de descobri-las apenas depois de um resultado surpreendente, é o que torna esse diagnóstico possível. A disciplina crucial que tudo isso serve é manter a auditoria de suposições legítima e verificável distinta dos resgates ad hoc e infalsificáveis contra os quais o critério de falsificabilidade no conceito anterior alerta, a diferença não é se uma explicação para um teste falhado existe, mas se essa explicação foi ela mesma especificada de antemão e independentemente verificável, ou inventada unicamente para salvar a hipótese depois do fato.

## Documentation Links

- [Stanford Encyclopedia of Philosophy — Karl Popper](https://plato.stanford.edu/entries/popper/) — doc
- [Stanford Encyclopedia of Philosophy — Science and Pseudo-Science](https://plato.stanford.edu/entries/pseudo-science/) — doc
