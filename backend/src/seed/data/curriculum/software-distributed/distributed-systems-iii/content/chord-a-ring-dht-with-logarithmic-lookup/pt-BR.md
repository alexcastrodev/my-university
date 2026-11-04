---
version: 1.0
updatedAt: 2026-11-04
title: "Chord: Uma DHT em Anel com Lookup Logarítmico"
summary: "O anel de identificadores do Chord, successors e finger tables, por que um lookup leva um número logarítmico de hops, e como a stabilization lida com nós que entram e falham."
---
## Objetivos de Aprendizagem

- Definir o anel de identificadores do Chord, o successor de uma chave e uma finger table, e montar uma à mão.
- Seguir `find_successor` num anel real e explicar cada decisão de encaminhamento.
- Provar o limite logarítmico pelo argumento da metade, e explicar por que a média observada é cerca de metade de `log2 N`.
- Percorrer um join com `stabilize` e `notify`, e dizer o que está errado em cada passo intermediário.
- Explicar contra o que as successor lists protegem, e o que a análise de Zave estabeleceu sobre a correção alegada do Chord.

## Contexto e Motivação

`consistent-hashing-for-data-partitioning` colocou nós e chaves no mesmo anel, de modo que o dono de uma chave é o primeiro nó no sentido horário. Ficou uma pergunta em aberto: como um nó encontra esse dono? O artigo do Chord aponta que o trabalho anterior sobre consistent hashing supõe que cada nó conhece a maioria dos outros, o que não escala para uma população peer-to-peer grande e mutável.

`unstructured-p2p-flooding-super-peers-and-bittorrent` mostrou o outro extremo, em que ninguém sabe nada e as queries são inundadas. O Chord, de Stoica e colegas, fica entre os dois. Sua interface inteira é uma operação: dada uma chave, mapeá-la para um nó. Num sistema de `N` nós, cada nó guarda informação sobre `O(log N)` outros, e um lookup leva `O(log N)` mensagens. Armazenamento, replicação e nomes ficam na camada de cima.

Nota de variante: esta lição segue o artigo de 2003 da IEEE/ACM Transactions on Networking (Figuras 5 e 6). O artigo do SIGCOMM 2001 apresenta primeiro um join agressivo que atualiza as finger tables de outros nós, depois o substitui por stabilization para joins concorrentes, e renova um finger aleatório em vez de percorrê-los em ciclo.

## Teoria Central

### O anel e a finger table

Identificadores têm `m` bits, vindos do SHA-1 do IP de um nó ou de uma chave, ordenados num círculo módulo `2^m`. A chave `k` pertence a `successor(k)`, o primeiro nó cujo identificador é igual a `k` ou vem depois dele.

Só os ponteiros de successor já dão lookups corretos em `O(N)` hops. Os fingers os tornam rápidos:

```text
n.finger[i] = successor((n + 2^(i-1)) mod 2^m),  1 <= i <= m
```

O finger 1 é o successor. Um nó conhece bem os vizinhos próximos e pouco os distantes, e em geral não consegue nomear o dono de uma chave qualquer pela própria tabela. Ele só conhece alguém mais perto. Fingers não são necessários para a correção, que exige apenas que cada nó conheça seu successor correto.

### Lookup

```text
n.find_successor(id):
  if id in (n, successor]:  return successor
  n' = closest_preceding_node(id)     // maior finger em (n, id)
  return n'.find_successor(id)
```

Cada nó encaminha ao finger que precede `id` mais de perto, porque quanto mais próximo de `id`, mais o nó sabe sobre aquela região. O simulador do artigo resolve lookups de forma iterativa, com o iniciador perguntando a cada nó, mas o caminho é o mesmo quando cada nó encaminha recursivamente.

### Por que é logarítmico

Seja `p` o nó que precede `k` imediatamente, e suponha que a query está em `n`. Tome o `i` tal que `p` esteja em `[n + 2^(i-1), n + 2^i)`. O intervalo não é vazio, então o finger `i` é algum `f` dentro dele. Agora, `f` está a pelo menos `2^(i-1)` de `n`, e `f` e `p` dividem um intervalo de largura `2^(i-1)`, logo `f` não está mais longe de `p` do que de `n`. A distância restante pelo menos cai à metade a cada hop, o que dá no máximo `m` hops. Com identificadores aleatórios fica melhor: depois de `2 log N` hops a distância é no máximo `2^m / N^2`, um intervalo que dificilmente contém outro nó, e o limite vira `O(log N)` com alta probabilidade.

A média observada é cerca de `(1/2) log2 N`. Leia a distância até o alvo em binário. Cada hop zera um bit 1, e só cerca de metade dos `log N` bits mais altos vale 1.

### Entrada de nós: stabilization

O Chord adiciona nós sem tocar nas tabelas dos outros no momento do join:

```text
n.join(n'):     predecessor = nil; successor = n'.find_successor(n)
n.stabilize():  x = successor.predecessor
                if x in (n, successor): successor = x
                successor.notify(n)
n.notify(n'):   if predecessor is nil or n' in (predecessor, n):
                    predecessor = n'
n.fix_fingers():       renova o próximo finger com find_successor
n.check_predecessor(): limpa predecessor se ele falhou
```

Todas essas operações, menos `join`, rodam periodicamente. O Teorema IV.3 do artigo diz que, se joins se intercalam com stabilizations, em algum momento depois do último join os ponteiros de successor formam um ciclo com todos os nós. Fingers defasados só custam velocidade, porque os lookups ficam aquém do alvo e depois caminham pelos successors. A correção depende dos successors, e o caso difícil é successor errado ou chaves ainda não movidas, em que o lookup pode falhar e a aplicação tenta de novo. Sob churn de até 12 joins e 12 leaves por período de stabilization em cerca de 1.000 nós, a Tabela III mostra no máximo 16 lookups falhos a cada 10.000.

### Falhas: successor lists

Um successor que falha pode quebrar o anel, então cada nó guarda seus primeiros `r` successors, e `closest_preceding_node` também busca nessa lista. Se cada nó falha de forma independente com probabilidade `p`, todos os `r` falham com probabilidade `p^r`. Teorema IV.5: com `r = Omega(log N)` numa rede inicialmente estável, se cada nó falhar com probabilidade 1/2, então com alta probabilidade `find_successor` ainda devolve o successor vivo mais próximo. A mesma lista diz à camada de cima onde manter réplicas, nos `k` nós depois da chave.

### O que "provably correct" acabou significando

Os artigos do Chord citam a correção demonstrável como traço distintivo. Pamela Zave modelou o protocolo de manutenção do anel em Alloy, entendendo correção como eventual reachability: com tempo de sobra e sem novas perturbações, o protocolo repara o anel. Seu resultado de 2012: "Under the same assumptions about failure behavior as made in the Chord papers, no published version of Chord is correct." Nenhuma das sete propriedades alegadas como invariantes no artigo do PODC vale para a versão do SIGCOMM, e a versão do PODC satisfaz uma, mas ainda assim não é correta. O protocolo só com joins é correto. O problema entra com as falhas, que podem deixar um anel quebrado, dois anéis ou um anel fora de ordem.

O artigo dela de 2015 traz uma especificação corrigida, com invariante indutivo e prova. Stabilization e reconciliação da successor list são combinadas, e um membro verifica se um nó está vivo antes de adotar um ponteiro para ele. A inicialização também muda: a rede precisa começar com pelo menos `r + 1` membros, e a prova supõe uma **stable base** de `r + 1` membros que nunca saem. Zave explica que as anomalias restantes só ocorrem em anéis pequenos, então quem implementa pode parar de preservar a base quando a rede crescer até um tamanho seguro.

## Exemplos Resolvidos

Tudo abaixo é saída de uma implementação em Python do pseudocódigo do ToN. Os três primeiros exemplos usam o anel da Figura 2 do artigo: `m = 6`, nós 1, 8, 14, 21, 32, 38, 42, 48, 51, 56.

### Exemplo 1: finger tables e caminhos reais de lookup

```text
          início -> finger para i = 1..6
N8    9->14  10->14  12->14  16->21  24->32  40->42
N42  43->48  44->48  46->48  50->51  58->1   10->14
N51  52->56  53->56  55->56  59->1    3->8   19->21

lookup(54) de N8:  N8 -> N42 -> N51, resposta N56
lookup(34) de N8:  N8 -> N32,        resposta N38
lookup(10) de N51: N51 -> N8,        resposta N14   (passa pelo 0)
lookup(63) de N1:  N1 -> N38 -> N56, resposta N1    (passa pelo 0)
```

Em `lookup(54)`, o maior finger de N8 dentro de (8, 54) é N42. Os fingers 58->1 e 10->14 de N42 passam do alvo, então 50->51 vence. Em N51, 54 está em (51, 56], e N51 devolve N56. Isso bate com a Figura 4(b) do artigo. Note `lookup(34)`: N8 não responde sozinho, já que N38 não está na tabela dele. Nos 640 pares de nó e chave deste anel, fingers dão média de 1,50 encaminhamento (pior caso 3), e só successors dão média de 4,50 (pior caso 9).

### Exemplo 2: N26 entra entre N21 e N32

Cada linha é o estado depois do passo, com `lookup(24)` rodado a partir de N8. Antes do join a resposta é N32, corretamente.

```text
passo              21.succ  26.succ  26.pred  32.pred  lookup(24) de N8
26.join(8)         32       32       nil      21       N8->N21, resposta N32
26.stabilize       32       32       nil      26       N8->N21, resposta N32
21.stabilize       26       32       21       26       N8->N21, resposta N26
```

N26 acha seu successor com um lookup comum, e ninguém mais muda. Depois, o `notify` de N26 muda o predecessor de N32. Só a stabilization do próprio N21 vira o anel, e nesse momento a resposta do lookup muda. Nas duas primeiras linhas, a chave 24 já pertence a N26, mas ainda é informada em N32. Na Figura 7 do artigo, N26 copia de N32 as chaves abaixo de 26, então N32 ainda pode servi-la.

Depois da terceira linha os successors estão certos, e cinco fingers pelo anel estão defasados: (N8, início 24), (N14, 22), (N21, 23 e 25) e (N56, 24). O lookup já estava correto sem eles. `fix_fingers` os conserta depois.

Como teste de estresse, o anel foi construído a partir de um nó, com os outros nove entrando por N1 antes de qualquer stabilization. Dez rodadas de `stabilize` em ordem aleatória deixaram todos os successors corretos. Mais seis rodadas de `stabilize` com `fix_fingers` deixaram todos os fingers corretos, e `lookup(54)` a partir de N8 fez o mesmo caminho do Exemplo 1.

### Exemplo 3: a falha sobre a qual o artigo avisa

Os nós 14, 21 e 32 falham juntos, e a stabilization não rodou. O caso do artigo é a chave 30 a partir de N8, cujo successor correto agora é N38.

```text
r   successor list de N8   lookup(30) de N8
1   [14]                   resposta N42  ERRADA
3   [14, 21, 32]           resposta N42  ERRADA
4   [14, 21, 32, 38]       resposta N38  correta
```

Com `r = 3` toda entrada está morta, e o contato vivo mais próximo de N8 é o finger 40->42, então ele trata N42 como successor. A resposta errada não é um crash, e nada a denuncia. Uma quarta entrada resolve, já que a lista só precisa alcançar um sobrevivente.

### Exemplo 4: medindo o limite

Anéis aleatórios, `m = 32`, ponteiros ideais, 20.000 lookups, contando encaminhamentos:

```text
N          16    64    256   1024  4096  16384
média      1,88  2,92  3,92  4,85  5,86  6,87
(1/2)log2N 2     3     4     5     6     7
pior caso  4     6     9     10    12    14
```

A metade foi conferida diretamente num anel de 1.024 nós. Em 97.495 encaminhamentos, a maior razão entre a distância nova e a antiga até o predecessor da chave foi 0,4996, abaixo do 0,5 que a prova promete. Um caminho real teve distâncias 2.293.836.370, depois 121.043.922, 49.700.333, 15.208.025, 4.324.995 e 0.

Reproduzir a Tabela II do artigo com `N = 1000` e `r = 20` dá caminho médio de 3,76 (artigo: 3,84, fórmula: 3,82). Com metade dos nós falhando de uma vez e sem reparo, dá 4,96 (artigo: 5,09), e nenhum dos 20.000 lookups devolveu um nó errado. O artigo também relata todos os lookups resolvidos.

### Exemplo 5: o contraexemplo de Zave em anel pequeno

Com `r = 2`, começando do jeito original a partir de um nó, que é o cenário da Figura 3 do artigo dela de 2015:

```text
48 cria o anel            48: [48, 48]
62 e 37 entram            62: [48, 48]   37: [48, 48]
62 notifica 48            48.pred = 62
48 faz stabilize          48: [62, 48]   62.pred = 48
48 falha                  62: [48, 48]   37: [48, 48]    sem successor vivo
```

Os dois sobreviventes têm uma lista de tamanho 2 com uma única entrada distinta, e não têm como se achar. Começando de um anel ideal de três nós (`r + 1`), as listas são 37: [48, 62] e 62: [37, 48], e depois da falha de 48 cada um ainda tem um successor vivo. A lista era longa o bastante, mas não diversa o bastante: suas entradas precisam ser nós distintos.

## Equívocos Comuns e Armadilhas

- **"Os fingers tornam o Chord correto."** Fingers o tornam rápido. O Exemplo 2 deu a resposta certa com cinco fingers defasados, e o Exemplo 3 errou por causa dos successors.
- **"Um lookup leva `log2 N` hops."** Essa é a ordem do limite. A média é cerca de metade, como mostra o Exemplo 4.
- **"Cada hop corta pela metade os nós restantes."** Corta a distância em identificadores. A contagem de nós só acompanha porque os identificadores são aleatórios.
- **"Um join termina quando o nó tem seu successor."** O Exemplo 2 mostra o anel ainda ignorando N26 nesse ponto.
- **"O Chord foi provado correto."** As provas originais não sobreviveram à análise de Zave sob as hipóteses dos próprios artigos. A versão corrigida dela está provada, com operações e inicialização alteradas e a hipótese da stable base.
- **"Essas falhas são só teóricas."** Zave registra essa visão e responde que a probabilidade de bugs sutis não pode ser conhecida sem hipóteses específicas de cada implementação, e que a pesquisa baseada em Chord precisa de um fundamento sólido.

## Resumo

O Chord atribui chaves por consistent hashing e acrescenta estado de roteamento de `O(log N)` fingers em distâncias potência de dois. Encaminhar ao finger precedente mais próximo pelo menos corta à metade a distância em identificadores a cada hop, o que dá `O(log N)` hops com alta probabilidade e cerca de `(1/2) log2 N` na prática. Joins são preguiçosos: `stabilize` e `notify` reparam successors, `fix_fingers` repara fingers, e só os successors importam para a correção. Successor lists sobrevivem a falhas simultâneas em massa, desde que um nó listado viva. Zave mostrou que o protocolo original não garante eventual reachability sob as hipóteses declaradas e deu uma versão corrigida, cujas dificuldades se concentram em anéis pequenos. `kademlia-and-pastry` continua com DHTs que roteiam por dígitos compartilhados ou distância XOR, e não por distância no sentido horário.

## Documentation Links

- [Stoica et al.: Chord: A Scalable Peer-to-peer Lookup Protocol for Internet Applications (IEEE/ACM ToN, 2003)](https://pdos.csail.mit.edu/papers/ton:chord/paper-ton.pdf): a versão que esta lição segue, com pseudocódigo de lookup e stabilization, teoremas e simulações.
- [Stoica et al.: Chord: A Scalable Peer-to-peer Lookup Service for Internet Applications (SIGCOMM 2001)](https://pdos.csail.mit.edu/papers/chord:sigcomm01/chord_sigcomm.pdf): o artigo original da conferência e sua apresentação anterior de join e stabilization.
- [Zave: Using Lightweight Modeling to Understand Chord (ACM CCR, 2012)](https://www.cs.princeton.edu/courses/archive/fall14/cos561/papers/ChordModel12.pdf): a análise em Alloy que mostra que as versões publicadas não têm eventual reachability, com contraexemplos aos invariantes alegados.
- [Zave: How to Make Chord Correct (arXiv, 2015)](https://arxiv.org/pdf/1502.06461): operações corrigidas, o invariante indutivo, a stable base e a prova.
