---
version: 1.0
updatedAt: 2026-11-04
title: "Kademlia e Pastry"
summary: "Duas DHTs que roteiam por dígitos compartilhados do identificador ou por distância XOR: os k-buckets do Kademlia, a tabela de roteamento do Pastry, e por que lookups paralelos e localidade importam na prática."
---
## Objetivos de Aprendizagem

- Calcular a distância XOR do Kademlia entre dois identificadores e colocar um contato no k-bucket correto.
- Acompanhar um lookup do Kademlia com os parâmetros `k` e `α`, e dizer quando ele termina.
- Rotear à mão uma mensagem do Pastry com o leaf set, a tabela de roteamento e a regra do caso raro.
- Explicar por que a métrica única do Kademlia e as duas métricas do Pastry podem apontar nós diferentes como o mais próximo da mesma chave.
- Dizer o que lookups paralelos e tabelas sensíveis à proximidade compram na prática, e o que não garantem.

## Contexto e Motivação

`chord-a-ring-dht-with-logarithmic-lookup` mostrou que estado logarítmico dá lookups logarítmicos. Esse limite não diz qual rota é rápida, nem o que um lookup faz quando um contato morreu em silêncio. Os autores do Kademlia formulam a queixa em termos do próprio Chord: a métrica assimétrica faz os nós não aprenderem nada útil para roteamento com as consultas que recebem, e cada finger precisa guardar um nó preciso, o que tira a liberdade de escolher por latência.

O Pastry (Rowstron e Druschel, Middleware 2001) e o Kademlia (Maymounkov e Mazières, IPTPS 2002) roteiam por prefixo do identificador, e ambos trocam "a única entrada correta" por uma escolha entre várias entradas válidas. Eles gastam essa liberdade de formas diferentes: o Pastry em proximidade de rede, o Kademlia em consultas paralelas. O posicionamento continua sendo a ideia de `consistent-hashing-for-data-partitioning`, com nós e chaves mapeados por hash no mesmo espaço, mas a regra de "mais próximo" muda.

## Teoria Central

### Kademlia: distância é XOR

IDs de nó e chaves têm 160 bits. A distância é `d(x, y) = x XOR y`, lida como inteiro. É uma métrica de verdade, embora não euclidiana. Duas propriedades fazem o trabalho:

- **Simétrica:** `d(x, y) = d(y, x)`. Os nós que consultam você se distribuem como os nós que a sua tabela quer, e como toda mensagem carrega o ID do remetente, o tráfego comum mantém a tabela.
- **Unidirecional:** para um ponto `x` e uma distância `Δ > 0`, exatamente um `y` satisfaz `d(x, y) = Δ`. Lookups de uma chave vindos de qualquer lugar convergem pelo mesmo caminho, e é por isso que fazer cache nesse caminho alivia hot spots.

Os zeros à esquerda de `x XOR y` contam o prefixo que `x` e `y` compartilham, então um nó pode se enxergar como folha de uma árvore binária. O protocolo garante a ele um contato em cada subárvore da qual não faz parte, se essa subárvore tiver algum nó.

### k-buckets

Para cada `0 <= i < 160`, um nó guarda até `k` contatos a uma distância em `[2^i, 2^(i+1))`. O exemplo do paper é `k = 20`, escolhido para que quaisquer `k` nós tenham probabilidade muito baixa de falhar dentro de uma mesma hora. Um bucket é ordenado pela última vez visto, com o mais antigo na cabeça. Quando chega uma mensagem:

```text
remetente já está no bucket  -> move para a cauda
bucket tem espaço            -> insere o remetente na cauda
bucket cheio                 -> faz ping na cabeça (visto há mais tempo)
    cabeça calada            -> remove a cabeça, insere o remetente na cauda
    cabeça responde          -> move a cabeça para a cauda, DESCARTA o remetente
```

Contatos vivos nunca são removidos. O paper dá dois motivos: traces do Gnutella mostraram que, quanto mais tempo um nó está no ar, mais provável é que fique mais uma hora, e inundar o sistema com nós novos não apaga o estado de roteamento existente.

A versão dos anais também faz a tabela crescer como árvore: um bucket cobre o espaço todo e se divide quando enche e a sua faixa contém o ID do próprio nó.

### O lookup: k, α e quem faz o trabalho

Um node lookup encontra os `k` nós mais próximos de um ID. O iniciador escolhe `α` nós (`α` é um parâmetro de concorrência do sistema, como 3) do seu bucket não vazio mais próximo e envia a eles RPCs `FIND_NODE` paralelos e assíncronos. Cada destinatário devolve os `k` contatos mais próximos que conhece. O iniciador então consulta `α` nós ainda não perguntados entre os `k` mais próximos de que ouviu falar, sem esperar todas as respostas anteriores. Se uma rodada não acha nada mais próximo que o melhor já visto, ele pergunta a todos os `k` mais próximos que faltam. Termina quando os `k` mais próximos vistos responderam.

O paper chama esse algoritmo de "recursive", mas é o iniciador que envia cada RPC; nenhum nó encaminha nada. Guardar um par significa `STORE` nesses `k` nós, repetido de hora em hora. `FIND_VALUE` para no primeiro nó que tem o valor, e o solicitante então faz cache do par no nó mais próximo que viu e que não o tinha.

O número esperado de hops é `log2 n`. Olhar `b` bits por hop aumenta a tabela para `2^b log_(2^b) n` buckets esperados e reduz os hops para `log_(2^b) n`. A implementação descrita no paper usa `b = 5`.

### Pastry: dígitos, depois números

Os nodeIds do Pastry são pontos de 128 bits num círculo, lidos como dígitos na base `2^b` (típico `b = 4`). Uma mensagem vai para o nó vivo numericamente mais próximo da sua chave. Cada nó mantém:

```text
tabela R         ceil(log_(2^b) N) linhas de 2^b - 1 entradas. A linha l guarda nós
                 que compartilham l dígitos com este nó e diferem no dígito l.
leaf set L       os |L|/2 nodeIds numericamente mais próximos, menores e maiores.
neighborhood M   os nós mais próximos por proximidade; normalmente fora do roteamento.
```

No nó `A`, com chave `D` e `shl` sendo o tamanho do prefixo comum em dígitos, o procedimento é:

```text
1. D dentro da faixa de L  -> encaminha ao membro de L mais próximo de D (ou para em A)
2. l = shl(D, A); R[l][dígito l de D] existe  -> encaminha para lá
3. caso raro -> encaminha a qualquer T em L, R ou M com shl(T, D) >= l e |T - D| < |A - D|
```

Cada passo aumenta o prefixo comum, ou o mantém e chega numericamente mais perto, então o roteamento sempre converge. Com `b = 4` e `10^6` nós, uma tabela tem em média 75 entradas e uma rota leva 5 hops esperados; com `10^9` nós, os números são 105 e 7. O caso 3 aparece em menos de 2% das rotas com `|L| = 2^b` e em 0,6% com `|L| = 2 × 2^b`. A entrega é garantida, a menos que `|L|/2` nós adjacentes falhem ao mesmo tempo.

### Localidade e paralelismo gastam a mesma liberdade

Muitos nós podem ocupar uma mesma entrada. O Pastry escolhe o mais próximo segundo uma métrica escalar de proximidade, como hops de IP, e um nó que entra herda e depois refina linhas dos nós da sua rota de join. Como cada linha escolhe num conjunto exponencialmente menor, os hops ficam mais longos conforme a rota avança. Em emulação com até 100.000 nós, as rotas do Pastry ficaram cerca de 30% a 40% mais longas que as de um esquema fictício com tabelas completas, com cerca de 75 entradas em vez de 99.999.

O Kademlia pode encaminhar para qualquer um de `k` nós, pode usar estimativas de round-trip para escolher os `α`, e tolera contatos mortos sem esperar por eles. O Exemplo 4 põe números aproximados nas duas ideias.

### Onde os dois desenhos se separam

Os autores do Kademlia descrevem o Pastry em duas fases: uma primeira que reduz a distância XOR pela metade, e uma segunda na diferença numérica. Nós próximos pela segunda métrica podem estar longe pela primeira, o que, segundo eles, cria descontinuidades e complica a análise formal. O Kademlia usa um algoritmo e uma métrica do começo ao fim. O paper do Pastry, que veio antes, sustenta o seu desenho com medições: com 5.000 nós e 500 falhando, a média de hops subiu de 2,73 para 2,96 antes do reparo e voltou a 2,74 depois.

**Paper vs. hoje:** os traces do Gnutella e o `b = 5` são de 2002. A Mainline DHT do BitTorrent (BEP 5) é uma descendente em produção: IDs de 160 bits, distância XOR e buckets de oito (`K`, "currently eight"), que só se dividem quando a faixa do bucket contém o ID do próprio nó. Ela guarda contatos de peers, não arquivos, e exige um token de um `get_peers` recente antes de aceitar `announce_peer`, o que impede um host de inscrever outros.

## Exemplos Resolvidos

Os quatro rodam num simulador. Os três primeiros compartilham uma rede: 64 nós, de `node-00` a `node-63`, e o ID de cada um são os primeiros 16 bits do SHA-1 do nome (sistemas reais usam 160 e 128 bits). As tabelas do Kademlia vêm de rodar o protocolo de join com `k = 3`, `α = 2`. As do Pastry são montadas com conhecimento global, `b = 2`, `|L| = 4`, e cada entrada escolhe o candidato mais próximo num plano de 1000 por 1000, o mesmo tipo de espaço usado no emulador do Pastry.

### Exemplo 1: distâncias XOR e atribuição a buckets

`SHA-1("node-01")` começa com `f20a49fc...`, então o nó é `f20a = 1111 0010 0000 1010`. Para um contato `839c`:

```text
f20a  1111 0010 0000 1010
839c  1000 0011 1001 1100
XOR   0111 0001 1001 0110 = 7196   bit mais alto ligado é o 14, logo bucket 14
```

A tabela real depois dos 64 joins:

```text
 i  faixa de distância  nós na faixa  contatos guardados (cabeça primeiro)
15  8000-ffff           25            280d 5953 0385
14  4000-7fff           19            839c 9a90 ad9f
13  2000-3fff           13            d1df dda9 ccba
12  1000-1fff            2            e072 e668
11  0800-0fff            2            fbcf fe0d
10  0400-07ff            1            f753
 9  0200-03ff            1            f10c
```

O nó guarda 15 dos outros 63, com densidade alta perto de si e baixa longe. Um contato novo para o bucket 15 dispara um ping para `280d`, e se `280d` responder, o recém-chegado é descartado.

### Exemplo 2: um lookup do Kademlia

`SHA-1("ubuntu.iso")` começa com `8b2c`. A partir de `f20a`, `d = f20a XOR 8b2c = 7926`, então o bucket não vazio mais próximo é o 14. As distâncias à chave estão entre parênteses:

```text
candidatos: 839c (08b0), 9a90 (11bc), ad9f (26b3)
rodada 1, pergunta a 839c, 9a90 -> aprende 88cd (03e1), 8f40 (046c), 8d2e (0602)
rodada 2, pergunta a 88cd, 8f40 -> nada mais próximo que 03e1
rodada 3, pergunta a 8d2e (o último não perguntado dos k mais próximos) -> nada mais próximo
resultado: 88cd, 8f40, 8d2e
```

Cinco RPCs, e o resultado bate com os três mais próximos de verdade na rede.

### Exemplo 3: uma rota do Pastry para a mesma chave

A chave é `20230230` na base 4. Do mesmo nó:

```text
hop  nó (base 4)       hex  shl  regra           dist numérica  dist XOR
 0   33020022         f20a   0   R[0][2]         66de           7926
 1   23203130         b8dc   1   R[1][0]         2db0           33f0
 2   20203031         88cd   3   leaf set        025f           03e1
 3   20310232         8d2e   2   entregue        0202           0602
```

O hop 1 tinha 19 nós elegíveis e ficou com o mais perto, a distância 188 no plano. O hop 2 tinha 4 e ficou com `88cd` a 107, contra 468 ou mais dos outros. O último hop veio do leaf set, que ignora proximidade: custa 584, e a rota soma 879 contra 412 direto.

Ir para `8d2e` reduz a distância numérica de `025f` para `0202`, encurta o prefixo comum de 3 para 2 e aumenta a distância XOR. Assim, o dono no Pastry é `8d2e`, enquanto o mais próximo no Kademlia é `88cd`. Nesta rede, as duas regras apontam nós diferentes para 16.831 das 65.536 chaves (25,7%). É a descontinuidade que os autores do Kademlia descrevem, visível em um hop.

### Exemplo 4: o que proximidade e paralelismo compram

São simulações pequenas, não resultados de nenhum dos papers. Pastry com 2.000 nós, `b = 4`, `|L| = 16`, no mesmo plano, em 20.000 rotas aleatórias:

```text
escolha da entrada   média de hops   tamanho da rota / distância direta
mais próxima          2,69           1,32
aleatória             2,69           2,70
```

A proximidade não muda os hops e corta o tamanho da rota pela metade. Os 32% a mais sobre a distância direta caem na faixa de 30% a 40% do paper.

Kademlia com 2.000 nós, `k = 8`, round trips de 0,2 ms por unidade do plano e timeout de 1000 ms, em 4.000 lookups. Os tempos vão até o iniciador ouvir o nó vivo mais próximo:

```text
nós mortos   α   mediana ms   p90 ms   RPCs por lookup
    0%       1      263         425         9,0
    0%       3      221         348        11,5
   10%       1      303        1356        10,1
   10%       3      234         377        12,3
```

Sem falhas, `α = 3` compra pouco. Com 10% de nós mortos, lookups sequenciais pagam um timeout inteiro por contato morto no caminho, e a cauda mostra isso: 1356 ms contra 377 ms, por cerca de 22% mais RPCs.

## Equívocos Comuns e Armadilhas

- **"Distância XOR é só distância numérica disfarçada."** No Exemplo 3, `8d2e` está numericamente mais perto de `8b2c` que `88cd`, enquanto `88cd` está mais perto por XOR.
- **"O lookup do Kademlia é recursivo, então os nós encaminham a consulta."** A palavra é do paper, mas é o iniciador que envia cada RPC. O desenho que encaminha hop a hop é o do Pastry.
- **"Um bucket cheio abre espaço removendo o contato mais antigo."** O mais antigo recebe um ping e, se estiver vivo, fica, enquanto o recém-chegado é descartado.
- **"`α` deixa os lookups mais rápidos."** Na maior parte, deixa-os menos frágeis. O Exemplo 4 mostra ganho pequeno sem falhas e ganho grande na cauda com falhas.
- **"Tabelas escolhidas por proximidade dão caminhos mínimos."** O paper do Pastry diz que o procedimento não garante a rota mais curta, porque cada decisão é local. Nós numericamente adjacentes ficam espalhados por construção, como mostra o último hop de 584 unidades do Exemplo 3.

## Resumo

O Kademlia mede distância por XOR, então uma única métrica simétrica e unidirecional comanda o roteamento e a manutenção da tabela. Seus k-buckets guardam até `k` contatos por faixa de distância e preferem contatos antigos e vivos, e seus lookups consultam `α` nós por vez até os `k` mais próximos responderem. O Pastry roteia hop a hop em dígitos na base `2^b`, termina numericamente por um leaf set e preenche cada entrada da tabela com um nó próximo. Os dois chegam a hops logarítmicos. Diferem no que "mais próximo" significa, em quem envia as mensagens e em como gastam a liberdade de ter vários próximos hops válidos. `publish-subscribe-over-a-dht` constrói em cima das rotas do Pastry a seguir.

## Documentation Links

- [Maymounkov e Mazières (2002): Kademlia, a peer-to-peer information system based on the XOR metric](https://pdos.csail.mit.edu/~petar/papers/maymounkov-kademlia-lncs.pdf): a métrica XOR, os k-buckets, o procedimento de lookup, a divisão da tabela e a comparação com o Pastry.
- [Rowstron e Druschel (2001): Pastry, scalable, decentralized object location and routing for large-scale peer-to-peer systems](https://people.mpi-sws.org/~druschel/publications/Pastry.pdf): estado do nó, procedimento de roteamento, localidade e resultados da emulação.
- [BEP 5: DHT Protocol](https://www.bittorrent.org/beps/bep_0005.html): a DHT baseada em Kademlia usada no BitTorrent, com suas regras de bucket, status de nó e mensagens `get_peers` e `announce_peer`.
