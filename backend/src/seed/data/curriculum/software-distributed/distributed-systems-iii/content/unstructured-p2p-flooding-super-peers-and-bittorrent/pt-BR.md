---
version: 1.0
updatedAt: 2026-11-04
title: "P2P Não Estruturado: Flooding, Super-Peers e BitTorrent"
summary: "Overlays não estruturados: flooding e seu custo, super-peers como meio-termo, e como o tit-for-tat e o rarest-first do BitTorrent trocam o problema de busca por um de disseminação."
---
## Objetivos de Aprendizagem

- Calcular o alcance de um flood limitado por TTL e explicar onde a estimativa em árvore deixa de valer num grafo real.
- Explicar por que é difícil escolher o TTL, e como expanding ring e múltiplos random walkers atacam, cada um, um dos dois desperdícios do flooding.
- Descrever uma rede de super-peers e enunciar o tradeoff entre carga agregada e carga individual.
- Explicar como o BitTorrent deixa de ser um sistema de busca, e o que rarest first e choking contribuem.
- Dizer o que o resultado de tit-for-tat prova e o que não prova sobre free riding.

## Contexto e Motivação

`the-client-server-and-p2p-architectures` apresentou peers que escalam sozinhos e observou que descoberta e transferência em massa são subproblemas diferentes. `gossip-and-epidemic-dissemination` mostrou o que contatos aleatórios fazem quando toda réplica quer toda atualização. Esta lição faz a pergunta mais difícil: peers entram e saem à vontade, ninguém controla o overlay nem onde os dados ficam, e um peer quer uma coisa específica.

Lv e colegas chamam esses sistemas de descentralizados e não estruturados: sem diretório central e sem controle preciso sobre topologia ou posição dos arquivos. O Gnutella era o exemplo famoso. Seu atrativo era a resiliência a nós que entram e saem, e seu problema era o custo de achar qualquer coisa. Seguem três respostas: buscar com menos tráfego, dar mais trabalho aos peers capazes e, na distribuição em massa, abandonar a busca de vez.

## Teoria Central

### Flooding e o dilema do TTL

Um nó Gnutella envia sua query a todos os vizinhos. Cada receptor consulta seus arquivos, decrementa um time-to-live e repassa aos outros vizinhos enquanto o TTL durar. A detecção de duplicatas impede que um nó repasse a mesma query duas vezes, mas a duplicata já custou uma interrupção ao receptor.

Jordan Ritter, um dos desenvolvedores fundadores do Napster, escrevendo em 2001, limitou isso numa rede idealmente balanceada em que cada nó mantém `N` conexões:

```text
reach(N, T) = soma de t = 1..T de N * (N-1)^(t-1)
```

Com `N = 4` e `T = 5` do cliente original, são 484 usuários, não importa quantos estejam online. Aumentar `N` ou `T` compra alcance geometricamente, e o tráfego cresce junto. Lv et al. nomeiam o dilema que resulta: TTL alto demais sobrecarrega a rede, baixo demais perde objetos que existem, e o valor certo depende de uma taxa de replicação que o usuário não tem como saber.

### Dois desperdícios, duas correções

**Expanding ring** ataca o problema do TTL: faz flood com TTL pequeno e tenta de novo com um maior até o objeto aparecer. Objetos populares param cedo, mas as duplicatas continuam.

**Random walks** atacam as duplicatas. Um walker repassa a query a um vizinho aleatório por vez. Um walker só reduz mensagens, mas aumenta o atraso em uma ordem de grandeza, então quem pergunta lança `k` walkers: `k` walkers depois de `T` passos alcançam mais ou menos os mesmos nós que um walker depois de `kT` passos. Os walkers terminam fazendo **checking** com quem perguntou, e o artigo achou que checar a cada quatro passos é um bom equilíbrio, com 16 a 64 walkers em geral dando bons resultados. Seu resultado com 32 walkers reduziu o overhead de mensagens em cerca de duas ordens de grandeza, com os hops subindo de 2-6 para 4-15. O mesmo artigo acha grafos aleatórios uniformes melhores que os de lei de potência, porque nós de grau alto concentram carga e multiplicam duplicatas.

### Super-peers

Yang e Garcia-Molina partem de outra observação: peers diferem enormemente, e ainda assim o Gnutella lhes dá deveres iguais. Quando a rede cresceu de repente em agosto de 2000, um estudo que eles citam viu peers em modem saturarem, morrerem e fragmentarem a rede. Um **super-peer** atende um cluster de clientes, mantém um índice sobre os dados deles e responde a queries em nome deles, enquanto os super-peers se ligam entre si como peers numa rede pura. Clientes enviam queries, joins e updates só ao seu super-peer. Uma rede pura é o caso degenerado de cluster de tamanho 1.

Suas regras práticas, saídas de um modelo de custo com tamanhos de mensagem do Gnutella e estatísticas medidas, são:

1. **Aumentar o cluster reduz a carga agregada, mas aumenta a individual.** No caso fortemente conectado, um super-peer com 100 clientes tem quase o dobro da carga de um com 50.
2. **Redundância de super-peer é boa.** Com 2-redundancy em cluster de tamanho 100 (fortemente conectado), a banda agregada subiu cerca de 2,5% e a banda individual de cada parceiro caiu 48%, embora o processamento agregado tenha subido cerca de 17%.
3. **Maximize o outdegree dos super-peers.** Subir o outdegree médio de 3,1 para 10 cortou o caminho esperado das respostas de 5,4 para 3 hops, desde que todos os super-peers o façam.
4. **Minimize o TTL.** Quando a query já alcança todos, TTL a mais só soma duplicatas: outdegree 20 com TTL 3 usou 19% menos banda agregada de entrada que TTL 4, com o mesmo alcance total.

O custo é que o super-peer vira ponto único de falha e possível gargalo do seu cluster.

### O BitTorrent muda a pergunta

O BitTorrent de Cohen não busca. Quem publica posta um arquivo `.torrent` com nome, tamanho, hashes das peças e a URL de um tracker. O tracker devolve uma lista aleatória de peers no mesmo arquivo, e seu papel se limita estritamente a ajudar peers a se acharem. O que sobra é um problema de disseminação, mais perto da lição anterior que do Gnutella: espalhar um arquivo conhecido por um grafo aleatório de peers que querem o arquivo inteiro.

```text
Peças:        arquivo cortado em peças (tipicamente um quarto de megabyte), cada
              uma com hash SHA1 no .torrent; o peer só anuncia a peça depois de
              conferi-la.
Sub-peças:    16 KB na rede, cerca de cinco pedidos em pipeline.
Seleção:      termina primeiro a peça começada (strict priority);
              aleatória até a primeira peça completa, pois o peer ainda não
              tem o que trocar;
              depois RAREST FIRST entre os próprios vizinhos;
              perto do fim, pede as sub-peças restantes a todos (endgame).
Choking:      faz upload a um número fixo de peers (padrão: quatro), escolhidos
              pela taxa de download vinda deles (média móvel de 20 s),
              recalculados a cada 10 s.
Otimista:     um peer extra liberado sem olhar a taxa, trocado a cada 30 s.
Snubbed:      sem peça de um peer por mais de um minuto, só faz upload a ele
              como optimistic unchoke.
```

Choking é uma variante de tit-for-tat: peers retribuem a quem envia para eles. O optimistic unchoke descobre parceiros melhores e, como nota Cohen, faz o papel de cooperar na primeira jogada do dilema do prisioneiro. Rarest first mantém cada peer com algo que os outros querem, e replica peças escassas antes que o seed ou o único detentor saia.

**Paper vs hoje:** a implantação de Cohen em 2003 dependia de trackers como único jeito de os peers se acharem. O BEP 5 acrescentou depois uma DHT baseada em Kademlia para torrents sem tracker, e `kademlia-and-pastry` cobre essa família. Piatek et al. (2007) testaram a alegação de incentivo em swarms reais e concluíram que o mecanismo "is not robust to strategic clients": o cliente BitTyrant deles ganhou 70% na mediana para um cliente de 1 Mbit em swarms reais, apoiado na descoberta de que todos os peers contribuem com recursos que não melhoram diretamente seu desempenho.

## Exemplos Resolvidos

Todos os modelos abaixo são desta lição, rodados em simulação. Tamanhos e parâmetros vêm dos artigos onde indicado, e os resultados não são dados dos artigos, salvo quando rotulados.

### Exemplo 1: onde a árvore de Ritter deixa de valer

Floods num grafo aleatório 4-regular de 10.000 nós, 200 origens por TTL, contra o limite `reach(4, T)`:

```text
 T | limite   | alcance | mensagens | duplicatas
 3 |      52  |    51,9 |     52,0  |   0,1%
 5 |     484  |   473,6 |    480,7  |   1,5%
 7 |   4.372  | 3.547   |  4.072    |  12,9%
 8 |  13.120  | 7.298   | 10.603    |  31,2%
 9 |  39.364  | 9.806   | 21.943    |  55,3%
10 | 118.096  | 9.999   | 29.409    |  66,0%
```

Até `T = 5` a árvore é quase exata, e o padrão alcança menos de 5% desta rede. Depois de `T = 7` o limite passa da população e deixa de prever qualquer coisa, enquanto as mensagens continuam subindo. Os dois últimos passos de TTL somam 2.700 nós por 18.800 mensagens: o dilema em números.

### Exemplo 2: reproduzindo a comparação de busca

Um grafo aleatório do tamanho usado por Lv et al. (9.836 nós, 20.099 enlaces), objetos em 1% dos nós, comparado com a Tabela 2 deles (query e replicação uniformes, grafo Random):

```text
método             mensagens por nó     nós visitados
                   sim       Tabela 2   sim      Tabela 2
flood, TTL = 8     2,60      2,509      9.162    9.220
expanding ring     0,066     0,062        570      536
32 walkers         0,028     0,031        135      149
```

O flooding visita quase tudo para achar um objeto que está em 1 nó a cada 100, quando cerca de 100 visitas bastariam em média. O ring economiza um fator de cerca de 40, os walkers cerca de 90. O checking soma cerca de 0,007 mensagem por nó aqui. Um walker sozinho precisou de 144 passos até o primeiro acerto, contra 7,2 com 32 walkers, e é por isso que quem pergunta paga pelo paralelismo.

### Exemplo 3: o tradeoff de super-peers no tráfego de query

10.000 peers, um overlay aleatório de grau médio 3,1, TTL 7, e o padrão de Yang e Garcia-Molina de 0,00926 query por usuário por segundo com queries de 94 bytes. Só as mensagens de query entram na conta. Respostas, joins e updates ficam de fora, então isto mostra a forma da regra 1, e não o modelo de custo deles.

```text
tamanho | nós do  | peers    | mensagens | mensagens por | chegadas num
cluster | overlay | cobertos | por query | peer coberto  | nó do overlay
    1   | 10.000  |  3.094   |   3.813   |    1,23       |  35/s,  27 kbps
   10   |  1.000  |  7.946   |   1.572   |    0,20       | 146/s, 110 kbps
  100   |    100  |  9.627   |     212   |    0,02       | 196/s, 147 kbps
```

Passar a cluster de tamanho 10 cobre 2,6 vezes os peers com 0,4 vez as mensagens. A taxa de chegada em cada super-peer sobe cerca de 4 vezes, porque as queries dos 10.000 usuários agora caem em 1.000 nós, e os clientes não veem nada disso. Na rede pura, todo peer gasta 27 kbps só com chegadas de query, cerca de metade de um modem de 56 kbps antes de qualquer resposta. O agregado melhora, o super-peer piora e os peers fracos ficam aliviados.

### Exemplo 4: rarest first contra seleção aleatória

200 peças, 50 leechers, um seed, pelo menos 8 vizinhos cada, todo peer enviando uma peça por rodada, 60 execuções:

```text
política  rodadas até   uploads    repetidos   completo se o seed sair
          terminar      do seed    pelo seed   após 220 uploads
random    238           230        30           3 de 60 execuções
rarest    228           214        14          60 de 60 execuções
```

O tempo final quase não muda, porque a capacidade agregada de upload é a mesma nas duas políticas. O que muda é o upload escasso do seed: rarest first desperdiça metade dos uploads do seed em peças que já estão no swarm. Isso decide a sobrevivência: swarms com rarest first sempre tinham o arquivo inteiro quando o seed saiu em 220 uploads, e os aleatórios quase nunca. Isso combina com a alegação de Cohen de que rarest first "does a good job of only downloading new pieces from the seed", ainda que não perfeito.

### Exemplo 5: o que o choking faz com um free rider

20 peers que sempre têm algo que os outros querem: 5 com upload 4, 14 com upload 1, um com upload 0. Cada um roda 4 slots regulares e 1 otimista, 200 execuções:

```text
classe             upload   download médio
rápido (5 peers)   4        3,08
lento (14 peers)   1        1,30
free rider (1)     0        0,36
```

Os totais batem, 34 de subida e 34 de descida, como Cohen nota que precisam bater. O download acompanha o upload, mas não exatamente: peers rápidos subsidiam os lentos pelos slots otimistas. O free rider recebe só capacidade otimista, um quinto de 34 dividido entre 19 candidatos, o que prevê 0,358 e bate com os 0,36 medidos. O tit-for-tat aqui pune o free riding sem eliminá-lo.

## Equívocos Comuns e Armadilhas

- **"O tráfego de flooding é exponencial para sempre."** É exponencial até o alcance saturar. O Exemplo 1 mostra as mensagens se estabilizando em cerca de três por nó, e o desperdício vira duplicata.
- **"TTL maior significa busca melhor."** A regra 4 de Yang e Garcia-Molina e o Exemplo 1 concordam: com cobertura total, TTL a mais só soma custo.
- **"Super-peers aliviam a carga de todo mundo."** A carga agregada cai e os clientes são aliviados, mas o super-peer carrega mais. A regra 1 existe porque as duas curvas andam em sentidos opostos.
- **"BitTorrent é um Gnutella melhor."** Ele responde a outra pergunta. Não acha arquivo por palavra-chave, já que o `.torrent` precisa estar em mãos.
- **"Rarest first é sobre velocidade."** O efeito principal no Exemplo 4 é sobrevivência e eficiência do seed.
- **"Tit-for-tat torna a contribuição obrigatória."** O Exemplo 5 e Piatek et al. mostram o contrário: slots otimistas alimentam free riders, e clientes estratégicos ganham contribuindo menos por peer.

## Resumo

O flooding espalha uma query para `N(N-1)^(t-1)` nós novos por hop até o grafo saturar, e seu TTL precisa ser definido sem saber quão raro é o objeto. Expanding ring elimina o chute do TTL e random walkers eliminam a maior parte das duplicatas, cortando o tráfego em até duas ordens de grandeza. Super-peers exploram a heterogeneidade, trocando carga agregada menor por carga individual maior e um ponto de falha por cluster. O BitTorrent contorna a busca por inteiro: um tracker fornece vizinhos aleatórios, rarest first mantém as peças disponíveis e o choking amarra download a upload, de modo imperfeito. Todos tratam localização como algo a buscar ou contornar. `chord-a-ring-dht-with-logarithmic-lookup` segue o outro caminho: impor estrutura e fazer localizar uma chave custar um número logarítmico de hops.

## Documentation Links

- [Ritter: Why Gnutella Can't Scale. No, Really. (2001)](http://www.darkridge.com/~jpr5/doc/gnutella.html): os limites de alcance e banda de uma rede Gnutella balanceada, com o vínculo do autor com o Napster declarado.
- [Lv et al.: Search and Replication in Unstructured Peer-to-Peer Networks (ICS 2002)](https://www.cse.uoi.gr/~pitoura/courses/p2p05/papers/searchp2p.pdf): limites do flooding, expanding ring, random walks com k walkers e comparação de topologias.
- [Yang and Garcia-Molina: Designing a Super-Peer Network (ICDE 2003)](https://kldp.org/files/superpeer_296.pdf): o modelo de super-peer, sua análise de custo, as regras práticas e k-redundancy.
- [Cohen: Incentives Build Robustness in BitTorrent (2003)](https://www.bittorrent.org/bittorrentecon.pdf): trackers, peças, seleção de peças e os algoritmos de choking.
- [Piatek et al.: Do Incentives Build Robustness in BitTorrent? (NSDI 2007)](https://www.cs.princeton.edu/courses/archive/fall14/cos561/papers/BitTyrant07.pdf): medição de altruísmo em swarms reais e o cliente estratégico BitTyrant.
- [BEP 5: DHT Protocol](https://www.bittorrent.org/beps/bep_0005.html): a DHT baseada em Kademlia usada em torrents sem tracker.
