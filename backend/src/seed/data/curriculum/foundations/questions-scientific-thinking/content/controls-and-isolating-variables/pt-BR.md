---
version: 1.0
updatedAt: 2026-09-06
title: Controles e Isolando Variáveis
summary: Um controle deve ser idêntico ao tratamento em tudo exceto a variável sob teste; comparações antes/depois confundem a mudança com tudo mais que variou no tempo, enquanto um controle concorrente e randomizado isola a variável de fato testada.
---
## Objetivos de Aprendizagem

- Explicar por que uma diferença medida entre "antes" e "depois" de uma mudança não é, por si só, evidência de que a mudança causou a diferença.
- Definir um controle (ou baseline) e enunciar qual condição ele deve satisfazer em relação ao tratamento sendo testado.
- Identificar variáveis que devem ser mantidas fixas para que uma comparação isole o efeito de uma única mudança.
- Projetar uma comparação estilo A/B, ou uma comparação de desempenho de sistemas, que inclua um controle apropriado.
- Diagnosticar um experimento descrito como propenso a confusão apontando para uma variável não controlada específica.

## Contexto e Motivação

Suponha que uma equipe implante uma nova estratégia de cache e, na semana seguinte, observe que a latência média de resposta caiu 15%. É tentador concluir que a estratégia de cache causou a melhoria, mas a conclusão de fato não segue apenas da observação. O volume de tráfego poderia ter sido mais baixo naquela semana; um deploy separado poderia ter sido lançado na mesma janela; o provedor de infraestrutura subjacente poderia ter resolvido um problema de capacidade do lado dele; o dia da semana ou época do ano poderia carregar padrões de carga sazonais. Qualquer uma dessas, inteiramente não relacionadas à mudança de cache, poderia produzir a mesma melhoria de 15%. Sem algo para comparar que tivesse experimentado todas essas mesmas condições exceto a própria mudança de cache, "a latência caiu depois que implantamos a mudança" e "a mudança causou a queda na latência" simplesmente não são a mesma afirmação, e tratá-las como se fossem é a forma mais comum pela qual a conclusão de um experimento ultrapassa sua evidência.

O conserto é o controle: uma condição de comparação idêntica à condição de tratamento em todo aspecto exceto a única variável sob teste. Um grupo controle, ou uma execução controle, ou uma medição de baseline não é uma formalidade adicionada a um experimento por aparência, é a única coisa que permite que uma diferença medida seja atribuída à mudança sob teste em vez de a tudo mais que também aconteceu de diferir. Essa ideia antecede a ciência experimental moderna por séculos em forma informal, mas se tornou metodologicamente central uma vez que se reconheceu que quaisquer dois pontos no tempo, ou quaisquer duas populações, diferem de dezenas de formas simultaneamente; isolar uma causa candidata exige engenheirar deliberadamente todas as outras para fora, ou mantendo-as fixas ou garantindo que se apliquem igualmente a ambas as condições sendo comparadas.

Isolar variáveis é a habilidade geral sobre a qual este conceito trata, e controles são o mecanismo concreto para fazer isso. As duas ideias são inseparáveis: um controle que difere do tratamento em mais que a única variável sob teste não é de fato um controle, e uma variável que não pode ser mantida fixa ou equiparada em ambas as condições é uma variável que o experimento de fato não isolou, por mais cuidadosamente que tudo mais tenha sido medido. Este conceito constrói diretamente sobre *Projetando um Experimento Mínimo*: uma vez que o conjunto mínimo de medições que discriminariam uma hipótese de sua alternativa foi identificado, isolar variáveis é o que garante que uma diferença medida naquelas medições específicas é de fato atribuível à única coisa sendo testada, em vez de a alguma outra diferença que se infiltrou junto.

## Teoria Central

### O que um controle tem que satisfazer

Um controle não é apenas "uma comparação", tem que satisfazer uma condição específica: deve ser idêntico ao tratamento em todo aspecto que poderia plausivelmente afetar o resultado, exceto pela única variável sob teste. Se o tratamento é "requisições servidas através da nova camada de cache, medidas na terça-feira à tarde," um controle de "requisições servidas através do sistema antigo, medidas na terça-feira anterior à tarde" é mais fraco do que parece, porque uma semana se passou e qualquer outra coisa que mudou naquela semana (uma atualização de dependência, uma mudança no comportamento do usuário, uma mudança na latência de serviço a montante) segue junto sem controle. Um controle mais forte roda ambas as condições concorrentemente, dividindo tráfego de outra forma idêntico entre o sistema antigo e o novo ao mesmo tempo, sob a mesma carga, de modo que a única diferença sistemática entre os dois grupos é a única variável sendo testada. A força de um controle é uma questão de grau, comparação concorrente e randomizada sob carga idêntica está próxima do ideal; uma comparação "antes/depois" separada por qualquer período de tempo significativo é um substituto muito mais fraco, útil apenas quando um controle concorrente verdadeiro é genuinamente impossível de organizar.

### Isolando uma variável: mantendo tudo mais fixo

Para testar o efeito de uma única variável, toda outra variável que poderia influenciar o resultado tem que ou ser mantida constante em ambas as condições, ou ser randomizada de modo que afete ambas as condições igualmente na média. Considere testar se um novo algoritmo de ordenação é mais rápido que o antigo. Manter fixo significa: mesmo hardware, mesmos dados de entrada, mesma carga de sistema, mesmo estado de aquecimento de compilador e JIT, mesma metodologia de medição, mudando apenas qual algoritmo roda. Se o novo algoritmo é testado em uma máquina mais tranquila, ou em uma distribuição de entrada mais amigável, ou depois de um período de aquecimento que o benchmark do algoritmo antigo não teve, a comparação não mais isola a mudança de algoritmo; ela isola "a mudança de algoritmo mais o que quer que mais tenha diferido," e a aceleração medida poderia ser inteiramente devida a este último. Quando uma variável genuinamente não pode ser mantida fixa, tráfego de produção real não pode ser congelado em um único padrão fixo para ambas as execuções, o conserto padrão é randomização: atribua requisições recebidas ao tratamento sistema-antigo ou sistema-novo aleatoriamente, de modo que quaisquer diferenças de padrão de tráfego tirem a média em ambos os grupos em vez de sistematicamente favorecer um.

### Teste A/B como comparação controlada

Teste A/B, familiar do trabalho de produto e UX, é exatamente essa lógica aplicada a uma população ao vivo de usuários: duas variantes (A, o controle/baseline; B, o tratamento) são mostradas a fatias atribuídas aleatoriamente e concorrentes da mesma população de usuários, de modo que qualquer outra coisa afetando o comportamento do usuário, horário do dia, dia da semana, campanhas de marketing rodando naquela semana, efeitos sazonais, atinge ambos os grupos igualmente. Se um redesign de UI (variante B) mostra uma taxa de conversão mais alta que o design atual (variante A) quando ambos são medidos ao longo do *mesmo* período em tráfego *dividido aleatoriamente*, a comparação isolou o redesign como a única variável diferente. Se em vez disso B fosse medido apenas depois de A já ter sido aposentado, sequencial em vez de concorrente, a comparação reintroduz exatamente a confusão que o exemplo de cache anterior ilustrou: qualquer outra coisa que mudou entre os dois períodos de medição se torna indistinguível do efeito do próprio redesign.

### Desempenho de sistemas: a mesma lógica, cenário diferente

A mesma exigência aparece em fazer benchmark de qualquer mudança de desempenho: uma execução controle sob carga, hardware, e configuração idênticos à execução de tratamento, diferindo apenas na única mudança sob teste. Um modo de falha comum é causado por efeitos de "vizinho barulhento" em infraestrutura compartilhada, a medição de tratamento acontece de cair em uma máquina que está momentaneamente sob menos carga externa que a usada anteriormente para o baseline, e a aceleração resultante é creditada à mudança de código em vez de à máquina mais tranquila. O conserto de isolamento, como acima, é ou rodar ambas as condições concorrentemente em hardware equiparado e dedicado, ou intercalar muitas execuções repetidas de cada condição no mesmo hardware para que ruído externo tenha uma chance igual de afetar qualquer uma delas, e depois comparar os resultados agregados em vez de uma única execução de cada.

## Exemplos Resolvidos

### Exemplo 1 — uma estratégia de cache, controlada apropriadamente

**Configuração.** A hipótese: "a nova camada de cache reduz a latência mediana de requisição." A comparação ingênua ("esta semana com o cache vs. a semana passada sem ele") confunde a mudança de cache com tudo mais que difere de semana para semana, volume de tráfego, deploys não relacionados, desempenho de serviço externo.

**Controle apropriado.** Divida o tráfego de produção ao vivo aleatoriamente no balanceador de carga: metade das requisições é roteada através da nova camada de cache (tratamento), metade através do caminho existente (controle), durante a *mesma* janela de tempo, de modo que ambos os grupos experimentem o mesmo volume de tráfego, o mesmo padrão de horário do dia, e o mesmo estado de todo outro sistema não relacionado.

**Isolando a variável.** Tudo sobre os dois caminhos é idêntico exceto a presença do cache, mesmos serviços a jusante, mesmo pool de hardware (ou distribuído aleatoriamente no mesmo pool), mesma mistura de requisição, porque o tráfego foi dividido aleatoriamente em vez de por tempo. Qualquer diferença resultante na latência mediana entre os dois grupos agora pode ser atribuída especificamente à camada de cache, porque o controle experimentou toda outra condição que o tratamento experimentou.

**Resultado e conclusão.** Se a latência mediana do grupo de tratamento é significativamente mais baixa que a do grupo controle, medida ao longo da mesma janela com as mesmas características de tráfego, a camada de cache, e não algum outro fator simultâneo, é a explicação, porque a possibilidade "algum outro fator simultâneo" era exatamente o que o controle concorrente e randomizado foi construído para descartar.

### Exemplo 2 — um benchmark de algoritmo, feito errado depois consertado

**Configuração.** Uma hipótese: "a nova implementação de ordenação é mais rápida que a antiga." Uma primeira tentativa de benchmark cronometra a implementação antiga em um runner de CI compartilhado de manhã, e a nova implementação no mesmo runner compartilhado à tarde, e relata a execução da tarde como 20% mais rápida.

**O que deu errado.** A comparação não isola o algoritmo de forma alguma, ela isola "a mudança de algoritmo mais o que quer que tenha diferido entre as cargas dos runners de manhã e tarde," e runners de CI compartilhados são notórios por exatamente esse tipo de variável, contenção de fundo não controlada. A figura de 20% poderia ser inteira, ou parcialmente, um artefato do runner da tarde estar menos carregado, com o próprio algoritmo contribuindo nada.

**Conserto.** Rode ambas as implementações lado a lado, várias vezes cada, intercaladas (antiga, nova, antiga, nova, …) no mesmo runner na mesma janela curta, usando os dados de entrada idênticos toda vez, e compare as cronometragens agregadas em vez de uma única execução de cada. Isso mantém hardware, entrada, e (aproximadamente) carga de fundo fixos em ambas as condições, isolando o algoritmo como a única coisa que difere de execução para execução.

**Resultado.** Suponha que a comparação intercalada e repetida agora mostre apenas uma diferença de 3%, bem dentro do ruído execução-para-execução observado para qualquer implementação individualmente. Isso revela que a figura original de 20% foi quase inteiramente um artefato de cronometragem de carga, uma medição "antes/depois" sem controle, não evidência sobre o algoritmo de forma alguma. O experimento corrigido, com um controle apropriado, dá o efeito real (e muito menor, se houver algum).

## Equívocos Comuns e Armadilhas

- **"Eu já tenho um baseline, os números de antes da mudança."** Um baseline medido em um tempo diferente é um controle fraco na melhor das hipóteses, porque o próprio tempo carrega toda outra variável que poderia ter mudado junto com a que está sob teste. Um controle concorrente e randomizado (mesma janela de tempo, população dividida ou execuções intercaladas) é evidência muito mais forte que qualquer comparação antes/depois, e deveria ser preferido sempre que for viável.
- **"Randomizar é só para ensaios médicos ou grandes experimentos voltados ao usuário, não se aplica a um pequeno benchmark interno."** Randomização (de qual execução acontece quando, qual máquina recebe qual condição, quais requisições recebem qual tratamento) é uma ferramenta geral para lidar com qualquer variável que não pode ser manualmente mantida fixa, e se aplica tanto a um script de benchmark de duas linhas quanto a um teste A/B em grande escala.
- **"Se ambos os grupos são grandes o suficiente, eu não preciso de um controle, as médias vão se resolver sozinhas."** Tamanho de amostra corrige ruído, não viés. Uma diferença sistemática entre dois grupos não concorrentes ou não randomizados (como o exemplo de carga de CI tarde-vs-manhã) não encolhe conforme o tamanho da amostra cresce; é uma característica estrutural de como os grupos foram formados, e apenas um controle genuíno a remove.
- **"O grupo controle não precisa ser idêntico, apenas similar."** "Similar" está fazendo muito trabalho não examinado nessa frase, todo o ponto de um controle é que ele corresponde ao tratamento em toda variável que poderia plausivelmente afetar o resultado. Qualquer diferença reconhecida entre controle e tratamento, além da que está sob teste, é uma confusão candidata (o assunto do próximo conceito nesta trilha) que tem que ser argumentada, não dispensada.

## Resumo

Um controle é uma condição de comparação idêntica ao tratamento em todo aspecto exceto a única variável sendo testada, e é o mecanismo que permite que uma diferença medida seja atribuída àquela variável em vez de a qualquer outra coisa que aconteceu de diferir junto. Isolar uma variável significa manter todo outro fator relevante fixo, ou randomizá-lo de modo que afete ambas as condições igualmente, seja o cenário um teste A/B ao vivo dividido através de tráfego concorrente de usuário ou um benchmark de desempenho de sistemas rodado em hardware compartilhado e barulhento. Uma comparação antes/depois separada no tempo é um substituto muito mais fraco para um controle concorrente e randomizado, porque o tempo carrega toda outra variável junto consigo, e um tamanho de amostra grande corrige ruído, não o tipo de viés sistemático que um controle ausente ou fraco deixa passar despercebido.

## Documentation Links

- [Stanford Encyclopedia of Philosophy — Science and Pseudo-Science](https://plato.stanford.edu/entries/pseudo-science/) — doc
- [Judea Pearl — The Book of Why (UCLA Causality Lab)](https://bayes.cs.ucla.edu/WHY/) — doc
