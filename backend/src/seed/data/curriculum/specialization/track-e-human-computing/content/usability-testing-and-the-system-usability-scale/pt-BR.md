---
version: 1.0
updatedAt: 2026-11-04
title: "Testes de Usabilidade e a System Usability Scale"
summary: "Planejar um teste de usabilidade, think-aloud, sucesso e tempo de tarefa, e pontuar corretamente a System Usability Scale."
---
## Objetivos de Aprendizagem

- Planejar um teste de usabilidade como formativo ou somativo, com tarefas, participantes e medidas de acordo.
- Nomear as variantes de think-aloud e dizer o que cada uma custa em validade e em tempo de tarefa.
- Calcular a fórmula de descoberta, mostrar como a resposta se move com a taxa de detecção $p$ e dizer o que "cinco usuários" significa.
- Pontuar corretamente a System Usability Scale, incluindo a inversão dos itens pares, e detectar o erro comum de pontuação.
- Dar a fonte e a amostra da média 68.

## Contexto e Motivação

`nielsens-ten-heuristics-and-heuristic-evaluation` prevê problemas sem usuários. Um teste de usabilidade observa usuários representativos tentando tarefas representativas. Nielsen reduz a versão básica a três passos: recrutar usuários representativos, dar a eles tarefas representativas e deixá-los falar.

Lewis e Sauro (2020) separam duas concepções do trabalho de usabilidade: detectar e eliminar problemas (formativa) e medir contra metas (somativa). Muitas discussões aqui nascem de aplicar um número de uma na outra. "Cinco usuários" é conselho formativo e não diz nada sobre a precisão de um tempo de tarefa ou de uma média SUS.

## Teoria Central

### Planejando um teste

| Decisão | Formativo | Somativo |
|---|---|---|
| Pergunta | O que quebra, e por quê? | Quão bem funciona contra uma meta? |
| Amostra | Poucos por rodada, depois corrigir e testar de novo | Maior, escolhida para um intervalo ou uma comparação |
| Falar durante as tarefas | Sim | Não, se tempo for medida |

As tarefas moldam o resultado. No CUE-2, relata Molich, nove times criaram 51 tarefas diferentes para a mesma interface, com pouca concordância sobre quais tarefas eram críticas, e Lindgaard e Chattratichart, segundo a linha do tempo de Sauro, mostraram com dados do CUE-4 que mudar as tarefas muda os problemas achados. Um teste cobre as tarefas que você escolheu, não o produto.

A observação muda o comportamento, e grupos de participantes convenientes podem não representar os usuários-alvo, como explica `human-studies-in-computing-research`.

### Think-aloud tem variantes

O think-aloud em usabilidade descende da análise de protocolos de Ericsson e Simon. A prática de usabilidade não é igual ao procedimento deles: Boren e Ramey documentaram as diferenças, e o resumo da Wikipedia é que os praticantes podem precisar intervir mais vezes do que Ericsson e Simon permitiriam.

| Variante | Quando a pessoa fala | Ponto forte | Custo |
|---|---|---|---|
| Concorrente | Durante a tarefa | Pode ser mais completa | Pode interferir na tarefa, embora alguns protocolos concorrentes não tenham mostrado interferência |
| Retrospectiva | Depois da tarefa, muitas vezes vendo a própria gravação | Menos chance de interferir | Dependência da memória e sessão mais longa (inferência, não vem da fonte) |
| Concorrente com sondagens | Durante a tarefa, com intervenções neutras | Alcança razões que o silêncio esconde | Intervenção sem treino enviesa o comportamento |

As duas primeiras linhas seguem o resumo da Wikipedia sobre Kuusela e Paul, exceto onde marcado. Nielsen (2012) lista os riscos da forma concorrente: a situação é artificial, as pessoas filtram o que dizem e um facilitador sem treino pode conduzi-las. Pernice (2014) dá três respostas neutras para quando o participante pergunta algo: **echo** repete as últimas palavras dele em tom de pergunta, **boomerang** devolve a pergunta ("What do you think?") e **Columbo** começa uma pergunta e a deixa pela metade, para que ele complete. O artigo de Nielsen sobre taxa de sucesso (2001) acrescenta uma troca que decide muitos planos: o tempo extra que os usuários gastam verbalizando contamina o tempo de tarefa, então uma sessão de think-aloud é má fonte de dados de tempo.

### Medidas

Relate sucesso de tarefa com regra declarada e tempo com as sessões que ele cobre, como em `usability-and-its-definition-iso-9241-11`. Nielsen (2006) analisou 1.520 medidas de tempo de tarefa em 70 tarefas e achou desvio padrão de 52% da média, depois de remover usuários excessivamente lentos, o que sustenta seu conselho de 20 usuários para métricas. O resumo posterior dele (2012) mantém as exceções separadas: pelo menos 20 para estudos quantitativos, 15 por grupo para card sorting, 39 para heatmaps estáveis de eyetracking.

### A fórmula por trás de "cinco usuários"

No artigo de Nielsen de 2000, o número de problemas achados por $n$ usuários é

$$N\bigl(1-(1-L)^n\bigr),$$

com $N$ o total de problemas e $L$ a proporção achada por um usuário, 31% nos dados dele, na média de projetos. A linha do tempo de Sauro registra outros valores: Virzi $p=0{,}32$, Lewis (1994) $p=0{,}16$. A mesma álgebra sai da binomial: um problema que afeta uma proporção $p$ dos usuários aparece pelo menos uma vez em $n$ usuários independentes com probabilidade $1-(1-p)^n$.

A hipótese importa mais que a álgebra. A fórmula precisa de usuários de uma só população e das mesmas tarefas, e trata $p$ como se um número descrevesse todos os problemas.

### O que "cinco usuários" significa

**Significa:** com $p=0{,}31$, cinco usuários têm cerca de 84% de chance de mostrar pelo menos uma vez um dado problema dessa frequência. Nielsen arredonda para 85%. Daí segue seu argumento prático: gaste um orçamento de 15 usuários em três rodadas de cinco, porque cada rodada confere as correções e expõe questões mais profundas.

**Não significa:**

- Que 85% de todos os problemas são achados. A leitura de Sauro é que você vê a maioria dos problemas que afetam 31% ou mais daquela população naquelas tarefas.
- Que cinco bastam por produto. Nielsen limita a fórmula a usuários comparáveis e sugere 3 ou 4 por grupo para dois grupos distintos.
- Que cinco bastam para números. A fórmula trata de descoberta, não de comparação nem de estimativa.
- Que um grupo qualquer de cinco é típico (Exemplo 2).

A evidência vem em escalas diferentes, então os números abaixo não são comparáveis. Faulkner (2003), como relata Straub (2004), testou 60 usuários de um sistema web de folha de ponto e sorteou 100 subconjuntos por tamanho: cinco usuários acharam em média 85% dos problemas revelados pelos 60, variando de 55% a quase 100%; dez acharam em média 95%, com mínimo de 82%. Spool e Schroeder (2001), no mesmo relato, acharam 35% com os cinco primeiros, e Sauro observa que seus usuários tinham tarefas abertas em até quatro sites. Cada denominador é diferente, e nenhum é o $N$ verdadeiro.

### A System Usability Scale

A SUS é um questionário de dez itens com cinco opções de resposta, criado por John Brooke em 1986 como instrumento "quick and dirty", segundo Sauro (2011). Os itens ímpares são positivos e os pares, negativos. Os dois primeiros são "I think that I would like to use this system frequently" e "I found the system unnecessarily complex".

Pontuação, segundo Sauro: nos itens ímpares subtraia 1 da resposta, nos pares subtraia a resposta de 5, some as dez contribuições e multiplique por 2,5. Cada contribuição vai de 0 a 4, então a soma vai de 0 a 40 e o escore de 0 a 100, em passos de 2,5.

**Não é porcentagem.** Um SUS de 68 é, aritmeticamente, 68% do máximo, mas fica por volta do percentil 50. Ler como 68% sugere "acima da média" quando é a própria média, então Sauro aconselha relatar o percentil. Ele dá um exemplo: 74 fica perto do percentil 70.

**O 68.** Vem do banco de dados de Sauro: ele relata mais de 5.000 usuários em 500 avaliações, e a média desses estudos é 68 (artigo de 2011; um artigo de 2013 fala em escores de 500 produtos). É a média do que foi testado, uma mistura de tipos de sistema, não nota de aprovação. A escala de notas do próprio Sauro põe 68 num C. Bangor et al. (2008), como relata Sauro (2018), usaram outros cortes: aceitável acima de cerca de 70, não aceitável abaixo de cerca de 50, marginal no meio. Ele também relata escores cerca de 11% maiores para usuários recorrentes de sites do que para os de primeira vez, e para usuários de software com cinco anos ou mais de experiência do que para os de 0 a 3.

**Não é diagnóstico.** Sauro observa que a SUS não diz o que está errado, e por isso ela anda junto com a observação. Ele também relata correlação modesta com conclusão e tempo, cerca de $r=0{,}24$, e que os itens 4 e 10 formam uma dimensão de learnability.

## Exemplos Resolvidos

### Exemplo 1: como a resposta se move com $p$

```text
porcentagem de problemas de frequência p vistos pelo menos uma vez
usuários   1     3     5     8    10    15    20
p=0,05   5,0  14,3  22,6  33,7  40,1  53,7  64,2
p=0,10  10,0  27,1  41,0  57,0  65,1  79,4  87,8
p=0,16  16,0  40,7  58,2  75,2  82,5  92,7  96,9
p=0,31  31,0  67,1  84,4  94,9  97,6  99,6  99,9
p=0,50  50,0  87,5  96,9  99,6  99,9 100,0 100,0
```

Cinco usuários dão 84,4% no $p$ de Nielsen, 58,2% no de Lewis e 22,6% para problemas que afetam um usuário em vinte. Chegar estritamente a 85% pede 6 usuários em $p=0{,}31$, 11 em $p=0{,}16$, 19 em $p=0{,}10$ e 189 em $p=0{,}01$. Sauro cita 5, 18 e 189 para 31%, 10% e 1%, arredondando 84,4% e 84,99% para cima.

### Exemplo 2: quando os problemas diferem

Suponha, sem nenhum estudo por trás, um produto com 40 problemas: dez em cada um de $p=0{,}6$, $0{,}31$, $0{,}1$ e $0{,}02$. O $p$ médio é $0{,}2575$, então a fórmula na média prevê 77,4% com cinco usuários. Tirar a média da fórmula sobre os problemas reais dá 58,5%, uma distância de 19 pontos que vem só da dispersão: 99% dos problemas frequentes são achados, e 10% dos raros.

Para a variação entre testes, sorteie `ps = numpy.array([.6]*10 + [.31]*10 + [.1]*10 + [.02]*10)` e `hits = numpy.random.default_rng(245).random((10000, n, 40)) < ps`, depois tome `hits.any(axis=1).mean(axis=1)`, com um gerador novo para cada $n$.

```text
usuários  média achada   mínimo   pct 5    pct 95   máximo
5         58,5%          35,0%    50,0%    67,5%    77,5%
10        70,2%          52,5%    62,5%    77,5%    92,5%
15        76,2%          60,0%    67,5%    85,0%    92,5%
```

Um único teste de cinco achou de 35% a 77,5%.

### Exemplo 3: pontuando a SUS

Os cinco respondentes abaixo são fictícios, inventados para exercitar a aritmética. Nenhum sistema foi testado.

```python
def sus(r):
    odd = sum(r[i] - 1 for i in range(0, 10, 2))   # itens 1, 3, 5, 7, 9
    even = sum(5 - r[i] for i in range(1, 10, 2))  # itens 2, 4, 6, 8, 10
    return 2.5 * (odd + even)
```

```text
       itens 1 a 10          escore  sem inversão (errado)
R1     4 2 4 2 4 2 4 2 4 2   75,0    50,0
R2     5 1 5 2 4 2 5 1 4 2   87,5    52,5
R3     3 3 3 3 3 2 4 3 3 3   55,0    50,0
R4     4 2 3 2 4 3 4 2 3 3   65,0    50,0
R5     2 4 2 4 3 4 3 4 2 4   30,0    55,0
média                        62,5    51,5
```

Para R2, as contribuições são 4, 4, 4, 3, 3, 3, 4, 4, 3, 3, que somam 35, e $35\times2{,}5=87{,}5$. A última coluna subtrai 1 de todo item. As redações positiva e negativa então se cancelam, e todos caem perto de 50, pensem o que pensarem, aqui de 50 a 55. Sauro relata que 11% dos pesquisadores pontuaram a SUS errado por esquecer de inverter os itens pares, e que esses erros ainda produzem escores de aparência válida.

Marcar sempre a mesma opção também se esconde. Quem responde 5 em tudo fica com 50, assim como quem responde só 3 ou só 1, então concordar com itens positivos e negativos parece um escore neutro.

### Exemplo 4: o que cinco escores podem dizer

A amostra fictícia tem média 62,5 e desvio padrão 21,8. Com $t_{0{,}975;4}=2{,}776$, o intervalo de 95% é $62{,}5\pm27{,}1$, ou seja, de 35,4 a 89,6. Contra 68, um teste $t$ de uma amostra dá $p=0{,}60$.

Lewis e Sauro dão 17,7 como desvio padrão típico da SUS. Nesse valor, um intervalo de $\pm10$ pede 15 respondentes e $\pm5$ pede 51, com o cálculo iterativo do $t$. Para mostrar uma média 10 pontos acima de um benchmark (unicaudal, 95% de confiança, 80% de poder), a tabela deles dá 21, e o mesmo cálculo a reproduz.

Taxas de conclusão se comportam igual. Cinco sucessos em cinco têm intervalo de Wilson de 95% de 56,6% a 100%, e 20 em 20 começa em 83,9%. `aggregation-variability-and-reporting` defende relatar essa variabilidade junto com qualquer média.

## Equívocos Comuns e Armadilhas

- **"Cinco usuários acham 85% dos problemas."** O número exige $p=0{,}31$, uma população e as mesmas tarefas, e conta os problemas frequentes o bastante para aparecer.
- **"68 é a nota de aprovação."** É a média de um banco de dados específico. As faixas de Bangor e as notas de Sauro são modos diferentes de lê-la.
- **"Falar em voz alta não afeta os dados."** Afeta pelo menos o tempo, então não relate tempos de think-aloud como benchmark.

## Resumo

O think-aloud tem formas concorrente, retrospectiva e com sondagens, e falar contamina o tempo de tarefa. A fórmula $1-(1-p)^n$ torna "cinco usuários" verdadeiro para uma população, um conjunto de tarefas e problemas perto de $p=0{,}31$: em $p=0{,}10$, cinco usuários dão 41%, e frequências misturadas dão bem menos do que a média sugere. Cinco é um bom tamanho de rodada e uma amostra ruim para números. A SUS soma itens ímpares menos 1 e 5 menos itens pares e multiplica por 2,5. Ela não é porcentagem, e sua média de 68 vem do banco de dados de Sauro, de cerca de 500 estudos.

## Documentation Links

- [Nielsen (2000): Why You Only Need to Test with 5 Users](https://www.nngroup.com/articles/why-you-only-need-to-test-with-5-users/): a fórmula, o valor de 31% e o argumento por várias rodadas pequenas.
- [Nielsen (2012): How Many Test Users in a Usability Study?](https://www.nngroup.com/articles/how-many-test-users/): as exceções e o argumento por mais estudos em vez de mais usuários.
- [Nielsen (2006): Quantitative Studies, How Many Users to Test?](https://www.nngroup.com/articles/quantitative-studies-how-many-users/): variabilidade do tempo de tarefa e o conselho dos 20 usuários.
- [Nielsen (2012): Thinking Aloud, the #1 Usability Tool](https://www.nngroup.com/articles/thinking-aloud-the-1-usability-tool/): o método, seus benefícios e seus riscos.
- [Nielsen (2001): Success Rate, the Simplest Usability Metric](https://www.nngroup.com/articles/success-rate-the-simplest-usability-metric/): por que verbalizar contamina o tempo de tarefa.
- [Pernice (2014): Talking with Participants During a Usability Test](https://www.nngroup.com/articles/talking-to-users/): echo, boomerang e Columbo.
- [Wikipedia: Think aloud protocol](https://en.wikipedia.org/wiki/Think_aloud_protocol): origens, variantes concorrente e retrospectiva e a crítica de Boren e Ramey, com referências.
- [Sauro (2010): Why you only need to test with five users (explained)](https://measuringu.com/five-users/): o que a binomial diz e o que não diz.
- [Sauro (2010): A Brief History of the Magic Number 5](https://measuringu.com/five-history/): linha do tempo do debate, com valores de $p$.
- [Straub (2004): Enough is enough... but five probably isn't](https://www.humanfactors.com/newsletters/enough_is_enough.html): relato de Faulkner (2003) e de Spool e Schroeder (2001).
- [Molich: CUE studies](https://www.dialogdesign.dk/cue-studies/): as tarefas criadas por times diferentes e a reprodutibilidade das avaliações.
- [Sauro (2011): Measuring Usability with the System Usability Scale](https://measuringu.com/sus/): itens, pontuação, a média de 68 e sua amostra.
- [Sauro (2013): 10 Things to Know About the System Usability Scale](https://measuringu.com/10-things-sus/): erros de pontuação, a versão toda positiva e efeitos da experiência.
- [Sauro (2018): 5 Ways to Interpret a SUS Score](https://measuringu.com/interpret-sus-score/): percentis, notas, adjetivos e faixas de aceitabilidade.
- [Lewis and Sauro (2022): Sample Sizes for Comparing SUS to a Benchmark](https://measuringu.com/sample-sizes-for-sus-benchmark-tests/): o desvio padrão típico e a tabela de amostras para benchmark.
