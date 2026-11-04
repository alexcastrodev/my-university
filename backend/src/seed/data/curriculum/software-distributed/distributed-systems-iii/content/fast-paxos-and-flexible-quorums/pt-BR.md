---
version: 1.0
updatedAt: 2026-11-04
title: "Fast Paxos e Quóruns Flexíveis"
summary: "O Fast Paxos e o seu caminho rápido que pula o líder, com os quóruns maiores que ele paga, e depois o Flexible Paxos, que mostra que só os quóruns da fase 1 e da fase 2 precisam se intersectar."
---
## Objetivos de Aprendizagem

- Explicar como uma rodada rápida do Fast Paxos economiza um atraso de mensagem, e por que os votos podem então se dividir.
- Enunciar o Quorum Requirement do Fast Paxos, derivar tamanhos de quórum a partir de N > 2F e N > 2E + F, e aplicar a regra de escolha de valor do coordenador depois de uma colisão.
- Enunciar a observação do Flexible Paxos de que só quóruns de fases diferentes precisam se intersectar, e explicar por que quóruns da mesma fase não precisam.
- Calcular os compromissos de disponibilidade de quóruns simples e em grade.
- Relacionar as duas ideias por meio do Fast Flexible Paxos.

## Contexto e Motivação

`multi-paxos-from-one-decision-to-a-replicated-log` deixou um líder no caminho normal de todo comando e uma maioria nas duas fases. Esta lição questiona esses dois padrões. O Fast Paxos (Lamport, 2006) tira o líder do caminho comum e paga com quóruns maiores. O Flexible Paxos (Howard, Malkhi e Spiegelman, 2016) mostra que as maiorias eram mais fortes que o necessário. Os dois são argumentos sobre o raciocínio de sobreposição de `primary-backup-vs-quorum-based-replication`: o que exatamente precisa se intersectar, e por quê?

## Teoria Central

### O caminho rápido

Lamport conta os atrasos entre a proposta de um cliente e o aprendizado. Com proponentes separados dos aceitadores, o padrão clássico leva três:

```text
clássico:  proponente -> líder -> aceitadores -> aprendizes
rápido:    proponente -> aceitadores -> aprendizes
```

Para abrir o atalho, as rodadas são divididas em rápidas e clássicas. Numa rodada rápida em que o coordenador está livre para escolher qualquer valor, ele envia uma mensagem especial "any" em vez de um valor, normalmente quando se torna líder e antes de existir qualquer proposta. Um aceitador então trata a primeira proposta que recebe como se viesse do coordenador. O atraso economizado é o salto pelo líder.

### O que quebra

Numa rodada clássica, um coordenador escolhe um valor, então todos os votos da rodada concordam. As rodadas rápidas perdem essa garantia: duas propostas enviadas quase ao mesmo tempo podem chegar aos aceitadores em ordens diferentes, e os votos se dividem. Lamport chama isso de colisão. A regra antiga da fase 2a, pegar o valor da rodada de maior número, para de funcionar, porque essa rodada agora pode ter vários valores.

O coordenador da rodada seguinte precisa então decidir a partir dos relatos de um quórum Q. Seja k a maior rodada reportada e V os valores votados na rodada k. A Observação 4 de Lamport dá o teste: um valor v só pode ter sido escolhido na rodada k se O4(v) vale, ou seja, se existe um k-quórum R cujos membros em Q votaram todos em v na rodada k.

```text
se nenhum aceitador de Q votou:   escolhe qualquer valor proposto
senão, se V tem um valor:         escolhe esse valor
senão, se algum w em V tem O4(w): escolhe w  (ele é único)
senão:                            escolhe qualquer valor proposto
```

A unicidade não é automática. Se O4(v) e O4(w) valessem ao mesmo tempo, o coordenador ficaria preso, sem poder descartar nenhum dos dois. O Quorum Requirement torna isso impossível:

```text
(a) quaisquer dois quóruns se intersectam
(b) quaisquer dois quóruns rápidos e qualquer quórum clássico
    ou rápido têm interseção não vazia
```

### Escolher os tamanhos

Quando os quóruns dependem só do tamanho, seja N - F o tamanho de um quórum clássico e N - E o de um quórum rápido. Para E <= F, o requisito se reduz a:

```text
N > 2F    e    N > 2E + F
```

Lamport dá duas escolhas naturais. Maximizar E rende E = F = ceil(N/3) - 1. Maximizar F rende F = ceil(N/2) - 1 e E = floor(N/4), que é o quórum rápido usual de três quartos. Isso não é um artefato de um algoritmo. O Fast-Accepting Lemma de Lamport mostra que um algoritmo geral de aprendizado rápido precisa atender à mesma condição de interseção, e o artigo dele sobre limites inferiores enuncia o limite como n > 2e + f.

O Fast Paxos ainda tem coordenador. Ele envia a mensagem "any" e, com E < F, decide se rodadas rápidas valem a pena. Cada coordenador também é dono de infinitas rodadas clássicas, porque é com elas que o progresso é garantido.

### Pagar pelas colisões

Lamport dá três saídas. Uma rodada completamente nova custa as duas fases. A recuperação coordenada trata as mensagens de fase 2b da rodada i como mensagens de fase 1b da rodada clássica i + 1 e acrescenta dois atrasos de mensagem. Na recuperação não coordenada, os aceitadores enviam mensagens de fase 2b uns aos outros e votam na rodada rápida i + 1, acrescentando um atraso, o que dá o limite de três atrasos sob colisão. Se as colisões forem frequentes demais, ele observa, o Paxos clássico pode ser melhor. Uma colisão exige propostas recebidas em ordens diferentes, então numa única Ethernet ele espera que ela seja extremamente rara.

### Flexible Paxos: só entre fases

Howard, Malkhi e Spiegelman separam os quóruns do Paxos em Q1 para a fase 1 e Q2 para a fase 2, e observam que só Q1 e Q2 precisam se intersectar. Nenhum Q1 precisa encontrar outro Q1, e nenhum Q2 outro Q2.

A prova mostra por quê. Suponha que v seja decidido no ballot p com quórum Q2, e tome o menor ballot posterior p' que propõe outra coisa, com quórum de fase 1 Q1. Algum aceitador está nos dois. Se ele tivesse visto prepare(p') primeiro, recusaria propose(p, v), contradizendo que aceitou; então aceitou primeiro, e reporta v ao ballot p'. Só uma interseção é usada. Dois quóruns de fase 2 não precisam se sobrepor porque um ballot clássico tem um coordenador e um valor, então aceitações conflitantes dentro de um ballot não acontecem, e ballots diferentes são tratados por Q1.

Isso também explica o Fast Paxos numa frase: uma rodada rápida abre mão desse valor único, então os quóruns rápidos precisam se sobrepor entre si, e precisam fazer isso dentro de todo quórum que os lê depois.

Como a replicação acontece muito mais que as trocas de líder, reduzir Q2 ajuda o caso comum. Com quóruns simples, a regra é |Q1| + |Q2| > N, e o menor Q1 válido é N - |Q2| + 1. O FPaxos sempre tolera |Q2| - 1 falhas, e com entre |Q2| e N - |Q2| falhas ele pode continuar replicando até que um novo líder seja necessário. O sistema não perde segurança quando um Q1 fica indisponível; ele perde a capacidade de trocar de líder.

O protótipo modificou o LibPaxos3 dentro de uma única VM, com uma rede simulada de 10 Mbps e 20 ms. Com 8 réplicas e |Q2| = 4, a latência caiu de 42 ms para 37 ms e a vazão subiu de 198 para 264 requisições por segundo. Os autores avisam que esse não é o quadro completo: parte do ganho existe mesmo com quóruns de tamanho idêntico, porque a versão deles envia mensagens só para um quórum.

A Seção 7 do artigo acrescenta que a segurança só exige que Q1 intersecte os Q2 usados com ballots menores, então um líder poderia anunciar o seu Q2. O artigo deixa os detalhes desse mecanismo fora de escopo.

### Combinar as duas ideias

O Fast Flexible Paxos (Howard, Charapko e Mortier, 2021) aplica o mesmo raciocínio ao Fast Paxos. Os únicos requisitos são entre os quóruns de fase 1 e os de fase 2 clássica, e entre os de fase 1 e qualquer par de quóruns rápidos de fase 2:

```text
q1 + q2c > n        q1 + 2 * q2f > 2n
```

O exemplo deles: com 11 aceitadores, q1 = 9, q2f = 7 e q2c = 3. A escolha de três quartos do Fast Paxos em n = 11 usa 9 para rodadas rápidas e 6 para clássicas.

## Exemplos Resolvidos

### Exemplo 1: tamanhos do Fast Paxos, verificados por força bruta

Todos os subconjuntos de cada tamanho foram intersectados para N até 9, e N > 2F com N > 2E + F bateu com a condição sobre conjuntos em todos os casos com E <= F.

```text
        E = F maximizados      F maximizado
N       clássico = rápido      clássico  rápido
5       4                      3         4
7       5                      4         6
9       7                      5         7
```

Em N = 7 com E = F, as fórmulas de Lamport dão 35 mensagens unicast contra 28 do Paxos clássico sob as hipóteses dele: um atraso a menos, 25 por cento mais mensagens.

### Exemplo 2: a regra de escolha depois de uma colisão

Considere N = 5 com quórum clássico 3 e quórum rápido 4. Os votos na rodada rápida k são a, a, a, b, b de A1 a A5, e o coordenador ouve Q = {A1, A2, A4}.

```text
V = {a, b}
O4(a): R = {A1, A2, A3, A5}, e R ∩ Q = {A1, A2}, todos a: verdadeiro
O4(b): todo conjunto de 4 contém A1 ou A2, que votaram a: falso
escolhe a
```

Se os votos fossem a, a, b, b com A5 em silêncio, e Q = {A1, A3, A5}, nenhum teste passa. Nenhum valor pode ter sido escolhido, porque a tem no máximo 3 votos possíveis e b também, então o coordenador pode escolher qualquer um.

Em todas as 2430 combinações de padrão de votos e Q, no máximo um valor passa em O4, e um valor de fato votado por quatro aceitadores sempre passa.

Agora reduza o quórum rápido para 3, violando N > 2E + F. Com A1 votando a, A2 votando b, os demais em silêncio e Q = {A1, A2, A3}, os dois testes passam: R = {A1, A4, A5} para a e R = {A2, A4, A5} para b. O coordenador não consegue descartar nenhum. Esse beco sem saída ocorre em 1080 das 2430 combinações.

### Exemplo 3: dois quóruns que não se intersectam

Considere N = 4 com |Q1| = 3 e |Q2| = 2, a melhoria para tamanhos pares do artigo. Enumerar todo quórum de fase 2 do ballot 1, quórum de fase 1 do ballot 2 e quórum de fase 2 do ballot 2 dá 144 combinações e 0 em que o ballot 2 pode perder o valor do ballot 1. Com |Q1| = 2, a contagem é 36 de 216.

```text
|Q1| = 2, |Q2| = 2, inseguro:
ballot 1: A1, A2 aceitam a               -> a decidido
ballot 2: a fase 1 alcança A3, A4        -> nenhum valor reportado
          A3, A4 aceitam b               -> b decidido
```

Com |Q1| = 3, todo quórum de fase 1 contém A1 ou A2, e dois quóruns de fase 2 disjuntos, {A1, A2} e {A3, A4}, continuam seguros.

### Exemplo 4: quóruns simples e em grade

```text
N = 10, |Q2| = 3, |Q1| = 8 (a maioria seria 6 e 6)
  até 2 falhas:        tudo funciona
  de 3 a 7 falhas:     a replicação continua, sem troca de líder
N = 8, |Q2| = 4, |Q1| = 5 (a maioria seria 5 e 5)
  até 3 falhas:        tudo funciona
  exatamente 4 falhas: a replicação continua
```

A grade de 20 aceitadores do artigo tem N1 = 5 colunas e N2 = 4 linhas. O FPaxos usa uma linha como Q1 (5 aceitadores) e uma coluna como Q2 (4), contra 11 de uma maioria e 8 da grade do Paxos, em que todos se intersectam, com uma linha mais uma coluna. Toda linha encontra toda coluna em exatamente um aceitador, e as linhas são disjuntas entre si. Agora importa quais aceitadores falham:

```text
uma coluna inteira fora:  a fase 2 funciona, a fase 1 não
                          (continua replicando, sem novo líder)
uma linha inteira fora:   a fase 1 funciona, a fase 2 não
                          (um líder pode recuperar e reconfigurar)
```

## Equívocos Comuns e Armadilhas

- **"O Fast Paxos não tem líder."** As propostas pulam o líder, mas um coordenador ainda inicia as rodadas, e as rodadas clássicas garantem o progresso.
- **"O Fast Paxos é sempre mais rápido."** Ele economiza um atraso quando não há colisão. O próprio Lamport diz que o Paxos clássico pode ser melhor se as colisões forem frequentes demais.
- **"O Flexible Paxos sai de graça."** Com quóruns simples, levar Q2 abaixo de N/2 eleva Q1 acima de uma maioria: no Exemplo 4, o sistema de 10 nós não consegue trocar de líder depois de 3 falhas, e um sistema de maioria conseguiria. O artigo também mostra que nem sempre é preciso abrir mão de disponibilidade ("not always necessary to compromise availability"): em N = 8, Q2 cai de 5 para 4 e Q1 fica em 5, e os quóruns em grade reduzem as duas fases, em troca de deixar de tolerar algumas combinações de falhas.
- **"Os quóruns Q2 precisam se sobrepor para que dois líderes não decidam ao mesmo tempo."** O Exemplo 3 mostra que Q2 disjuntos são seguros. Quem impede o conflito é a fase 1 do ballot maior.
- **"Três quartos é o único quórum rápido."** É uma escolha para F máximo. O Fast Flexible Paxos mostra que quóruns rápidos menores são possíveis ao custo de uma fase 1 maior: 7 em vez de 9 em n = 11, com quórum de fase 1 de 9.

## Resumo

O Fast Paxos deixa os proponentes alcançarem os aceitadores diretamente, economizando um atraso, mas os aceitadores de uma rodada rápida podem votar diferente. Um coordenador posterior precisa identificar o único valor que pode ter sido escolhido, o que exige que quaisquer dois quóruns rápidos se intersectem dentro de todo quórum: N > 2F e N > 2E + F. As colisões custam atrasos extras e podem tornar o Paxos clássico preferível. O Flexible Paxos vai no sentido oposto e mostra que o Paxos clássico só precisa de interseção entre fases, então os quóruns frequentes da fase 2 podem encolher enquanto os raros da fase 1 crescem. As duas coisas se encontram numa ideia: conte o que precisa se sobrepor, porque um valor único por ballot é o que deixa os quóruns de fase 2 serem disjuntos, e uma rodada rápida não tem mais isso.

## Documentation Links

- [Lamport: Fast Paxos (Distributed Computing 2006, MSR-TR-2005-112)](https://ilyasergey.net/CS6213/_static/papers/fast-paxos.pdf): rodadas rápidas, a mensagem "any", a Observação 4, o Quorum Requirement, a recuperação e os custos.
- [Lamport: Lower Bounds for Asynchronous Consensus (MSR-TR-2004-72)](https://lamport.azurewebsites.net/pubs/lower-bound.pdf): o Fast-Accepting Lemma e o limite n > 2e + f.
- [Howard, Malkhi & Spiegelman: Flexible Paxos, Quorum Intersection Revisited (2016)](https://arxiv.org/abs/1608.06696): a observação sobre Q1 e Q2, quóruns simples e em grade, a prova de segurança e o protótipo.
- [Howard, Charapko & Mortier: Fast Flexible Paxos (ICDCN 2021)](https://arxiv.org/abs/2008.02671): os requisitos de interseção relaxados para o Fast Paxos.
