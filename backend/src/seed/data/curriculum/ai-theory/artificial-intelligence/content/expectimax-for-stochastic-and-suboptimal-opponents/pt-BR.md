---
version: 1.0
updatedAt: 2026-09-06
title: Expectimax para Oponentes Estocásticos e Subótimos
summary: O minimax presume um adversário perfeitamente racional, mas dados, cartas e oponentes imperfeitos pedem um nó de acaso que tira a média dos resultados ponderada pela probabilidade, em vez de pegar o pior caso. É o mesmo esqueleto de busca em árvore com um tipo de nó trocado, e com a poda em grande parte perdida como consequência.
---
## Objetivos de Aprendizagem

- Explicar por que a premissa de pior caso do minimax é o modelo errado para ambientes com aleatoriedade genuína (dados, cartas embaralhadas) em vez de um adversário racional.
- Definir um nó de acaso e enunciar a regra de valor do expectimax: o valor esperado dos filhos, ponderado pelas probabilidades, em vez de um mínimo ou um máximo.
- Rastrear o expectimax em uma árvore pequena com uma distribuição de probabilidade explícita sobre os resultados de acaso.
- Explicar por que a poda alfa-beta em geral não se aplica, ou se aplica só de formas limitadas, a árvores de expectimax.
- Distinguir "o oponente é aleatório" de "o oponente é subótimo, mas ainda adversarial", e explicar por que o expectimax modela corretamente o primeiro caso, e não o segundo.

## Contexto e Motivação

O minimax e a poda alfa-beta, vistos nos dois conceitos anteriores, presumem a mesma coisa sobre o jogador que não é MAX: ele é um adversário perfeitamente racional que sempre vai escolher o resultado pior para MAX. Essa premissa está exatamente certa para jogos como xadrez ou jogo da velha, mas exatamente errada para uma classe grande e importante de jogos que envolvem acaso genuíno: os dados do gamão, o embaralhamento de um jogo de cartas, ou qualquer ambiente em que o próximo estado depende de um evento aleatório, e não da escolha estratégica de outro agente. Tratar uma rolagem de dado como se fosse um adversário tentando deliberadamente prejudicar você produz decisões sistematicamente erradas: um jogador de gamão baseado em minimax presumiria que os dados estão conspirando contra ele, e não é assim que dados funcionam.

O expectimax mantém exatamente o mesmo esqueleto recursivo de busca em árvore do minimax (a mesma travessia em profundidade, a mesma alternância entre tipos de nó em níveis diferentes) e muda só uma coisa: onde quer que um nó represente um evento aleatório, e não uma escolha de algum jogador, ele vira um **nó de acaso**, cujo valor é a média dos filhos ponderada pela probabilidade, em vez de um mínimo ou um máximo. É uma mudança pequena e cirúrgica no algoritmo, com um ganho conceitual real: é o primeiro ponto desta disciplina em que as probabilidades reais dos diferentes resultados, e não só a existência deles, passam a fazer parte do próprio cálculo da decisão.

## Teoria Central

### Nós de acaso e o valor do expectimax

Uma **árvore de expectimax** tem três tipos de nó: nós MAX (iguais aos do minimax: o agente maximizando o próprio resultado), nós MIN (usados só quando ainda há um oponente genuinamente adversarial presente junto com a aleatoriedade) e **nós de acaso**, que representam um evento cujo resultado é determinado por uma distribuição de probabilidade conhecida, e não pela escolha de algum agente.

O valor de um nó de acaso é definido como seu **valor esperado**:

```text
valor(nó de acaso) = Σ  P(resultado) × valor(filho daquele resultado)
                    sobre todos os resultados possíveis
```

É o mesmo cálculo de valor esperado já visto como ideia central de probabilidade: um nó de acaso em uma árvore de jogo não passa de uma variável aleatória cujos valores possíveis são os valores dos seus filhos, ponderados pela probabilidade real de cada filho.

### Por que a poda alfa-beta em grande parte não se transfere

A correção da poda alfa-beta depende de a garantia de um nó MIN só *piorar* (diminuir) conforme mais filhos são explorados, o que deixa o algoritmo concluir com segurança que "o valor de MIN aqui já está baixo o bastante para MAX evitar este ramo, não importa o que reste". O valor esperado de um nó de acaso não se comporta assim: um filho não explorado pode ter um valor extremamente alto ou baixo e, como o valor final é uma *média* ponderada, um único resultado restante não explorado ainda pode mudar bastante o total, mesmo que tudo examinado até ali pareça ruim (ou bom). Alguma poda ainda é possível em casos especiais (por exemplo, se a faixa de valores dos resultados restantes for limitada e os pesos forem conhecidos), mas a garantia de poda limpa e geral disponível no minimax não se transfere da mesma forma para nós de acaso. É um custo estrutural real de introduzir aleatoriedade, e não um detalhe menor de implementação.

### Oponente aleatório vs. oponente subótimo: uma distinção crítica

O expectimax modela corretamente um oponente cujo comportamento é governado por **probabilidades conhecidas e fixas**: um dado que cai em cada face com probabilidade 1/6, um baralho embaralhado. Ele **não** modela corretamente um oponente que é simplesmente um jogador estratégico *mais fraco ou não ótimo*, mas que continua tentando vencer. Um oponente fraco de xadrez não equivale a um gerador de jogadas aleatórias: um oponente fraco ainda costuma jogar de forma razoável e de vez em quando comete erros graves de jeitos específicos e exploráveis, o que é uma distribuição de probabilidade sobre jogadas muito diferente de "uniformemente aleatória". Tratar um adversário fraco como literalmente aleatório superestima a frequência com que ele fará uma jogada realmente péssima e subestima o valor de provocar especificamente o tipo de erro a que ele é propenso. O expectimax é a ferramenta certa exatamente quando a fonte de incerteza é acaso mecânico genuíno (dados, embaralhamentos, sensores ruidosos), e não quando é só "um oponente que acredito jogar pior que o ótimo".

### Funções de avaliação se aplicam aqui do mesmo jeito que no minimax

Assim como no minimax, uma árvore de expectimax completa para um jogo real (gamão, por exemplo) é grande demais para ser expandida até os estados terminais. O mesmo compromisso prático se aplica: buscar até uma profundidade limitada e usar uma função de avaliação heurística para estimar o valor dos nós não terminais no corte, exatamente como faria uma busca minimax com profundidade limitada. Introduzir nós de acaso não muda nada nessa necessidade; ela é independente de a estrutura restante ser determinística ou estocástica.

## Exemplos Resolvidos

### Exemplo 1: valor esperado em um nó de acaso

Considere um jogo de dados simplificado em que, depois da jogada de MAX, um dado justo de seis faces determina qual de duas posições seguintes possíveis é alcançada: tirar de 1 a 3 leva a uma posição que vale 4 para MAX, e tirar de 4 a 6 leva a uma posição que vale 10.

```text
Filhos do nó de acaso:
  Resultado "1-3" (probabilidade 3/6 = 0.5): valor 4
  Resultado "4-6" (probabilidade 3/6 = 0.5): valor 10

Valor esperado = 0.5 × 4 + 0.5 × 10 = 2 + 5 = 7
```

O valor do nó de acaso, 7, não é o mínimo (4) nem o máximo (10) dos filhos: é exatamente a média ponderada que uma rolagem de dado de fato produziria em jogadas repetidas. Nem a operação de mínimo nem a de máximo do minimax seriam a regra de combinação correta aqui.

### Exemplo 2: uma árvore de expectimax pequena, com MAX escolhendo entre dois ramos de acaso

```text
                     MAX (raiz)
                    /           \
              Acaso A          Acaso B
              /      \         /      \
            0.5      0.5     0.3      0.7
            (2)      (14)    (6)      (6)

Valor do Acaso A = 0.5×2 + 0.5×14 = 1 + 7 = 8
Valor do Acaso B = 0.3×6 + 0.7×6 = 6            (os dois resultados têm o mesmo valor aqui)

Raiz: max(8, 6) = 8 → MAX deve escolher o ramo A
```

Compare isso com o tratamento do minimax para uma árvore parecida: se fossem nós MIN em vez de nós de acaso, MIN mandaria MAX para o filho pior; o pior caso do Ramo A (2) fica bem abaixo dos 6 garantidos do Ramo B, então uma análise de minimax (errada, para este jogo) favoreceria o Ramo B. O expectimax reconhece corretamente que o resultado *médio* do Ramo A (8) é na verdade melhor, porque o resultado ruim (2) só acontece metade das vezes e o resultado bom (14) acontece na outra metade; exatamente o cálculo que importa quando a incerteza é acaso genuíno, e não um oponente hostil e otimizador.

### Exemplo 3: por que tratar o acaso como adversarial dá a decisão errada

Reaproveitando os números do Exemplo 2, suponha que quem projetou o agente tenha modelado por engano os resultados dos dados como nós MIN em vez de nós de acaso:

```text
Tratamento (incorreto) com minimax:
  "MIN" A: min(2, 14) = 2
  "MIN" B: min(6, 6)  = 6
  Raiz: max(2, 6) = 6 → escolhe o Ramo B

Tratamento (correto) com expectimax:
  Acaso A: 0.5×2 + 0.5×14 = 8
  Acaso B: 6
  Raiz: max(8, 6) = 8 → escolhe o Ramo A
```

Os dois modelos discordam sobre qual ramo é de fato melhor, e a resposta do expectimax é a que corresponde ao que realmente aconteceria, em média, ao longo de muitas repetições desse evento aleatório. Esse é o custo concreto de usar o modelo errado de incerteza: não um pequeno erro numérico, mas uma decisão diferente e pior.

## Equívocos Comuns e Armadilhas

- **"O expectimax sempre toma decisões melhores que o minimax."** Nenhum dos dois algoritmos é universalmente melhor; cada um é correto para um tipo diferente de incerteza. Usar expectimax contra um oponente de fato adversarial (presumindo que ele joga "na média" em vez de jogar de forma ótima contra você) pode ser muito explorado, assim como usar minimax contra aleatoriedade genuína produz decisões pessimistas demais e erradas.
- **"Um oponente fraco ou vencível pode ser modelado como um nó de acaso."** Um oponente subótimo, mas que ainda tenta vencer, tem uma distribuição de probabilidade sobre jogadas que depende da posição e das fraquezas específicas dele; não é o mesmo que uma distribuição fixa, conhecida e independente da posição, como um dado justo, e modelá-lo assim desperdiça oportunidades de provocar especificamente os erros conhecidos desse oponente.
- **"A poda alfa-beta funciona do mesmo jeito em árvores de expectimax."** A garantia de poda limpa do minimax depende de um mínimo/máximo estrito em cada nó interno; o valor esperado de um nó de acaso é uma média que um único filho não explorado ainda pode mudar bastante, então a mesma regra de poda incondicional em geral não se aplica.
- **"O expectimax precisa conhecer as probabilidades exatas para ter alguma utilidade."** Na prática, as probabilidades usadas (faces de dados, chances de cartas) costumam ser conhecidas exatamente a partir das próprias regras do jogo, e é justamente por isso que o expectimax é o padrão, e não uma aproximação de último recurso, em jogos com aleatoriedade bem definida, como o gamão ou muitos jogos de cartas.

## Resumo

O expectimax adapta exatamente o esqueleto recursivo de busca em árvore do minimax a ambientes com aleatoriedade genuína introduzindo nós de acaso, cujo valor é o valor esperado dos filhos ponderado pela probabilidade, em vez de um mínimo ou máximo estrito; o modelo correto quando a incerteza vem de mecânicas de probabilidade conhecida e fixa (dados, cartas embaralhadas), e não da escolha estratégica de outro agente. Isso distingue corretamente "o próximo estado é aleatório" de "o próximo estado é escolhido por um adversário", uma distinção que a premissa de pior caso do minimax erra, com o custo real de que as garantias limpas da poda alfa-beta em grande parte não se transferem para nós de acaso. A busca adversarial (minimax, alfa-beta e expectimax juntos) fecha a resposta desta disciplina para ambientes sequenciais com vários agentes, determinísticos ou estocásticos; os próximos três conceitos se voltam para um formato de ambiente completamente diferente: problemas de um único agente cuja dificuldade vem não de um oponente, mas de muitas restrições interligadas entre variáveis.

## Documentation Links

- [UC Berkeley CS188: Introduction to Artificial Intelligence](https://inst.eecs.berkeley.edu/~cs188/sp24/): curso que cobre o expectimax como a generalização direta do minimax para jogos estocásticos.
- [Russell & Norvig: Artificial Intelligence: A Modern Approach](https://aima.cs.berkeley.edu/contents.html): o tratamento canônico de nós de acaso e de jogos com elemento de acaso, como o gamão.
