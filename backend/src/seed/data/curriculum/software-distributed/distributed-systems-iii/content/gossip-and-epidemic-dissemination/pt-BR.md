---
version: 1.0
updatedAt: 2026-11-04
title: "Gossip e Disseminação Epidêmica"
summary: "Algoritmos epidêmicos do trabalho da Xerox PARC: gossip em push, pull e push-pull, a velocidade com que um rumor se espalha, e a diferença entre anti-entropy e rumor mongering."
---
## Objetivos de Aprendizagem

- Nomear as três estratégias de distribuição de atualizações do trabalho epidêmico da Xerox PARC (direct mail, anti-entropy, rumor mongering) e dizer do que cada uma abre mão.
- Distinguir push, pull e push-pull, e usar as recorrências para explicar por que pull vence quando restam poucos sites desinformados.
- Definir residue, traffic e delay, e usar `s = e^-m` para estimar quanto custa um rumor em push para atingir um residue desejado.
- Explicar por que um rumor pode morrer com sites ainda desinformados, e por que anti-entropy pouco frequente fecha essa lacuna.
- Explicar por que a escolha uniforme de parceiro é ao mesmo tempo a hipótese da análise e a parte cara da implantação.

## Contexto e Motivação

A replicação update-everywhere, como enquadrada em `replicating-a-database-eager-vs-lazy-primary-copy-vs-update-everywhere-and-certification`, precisa de algum jeito de levar cada atualização a todas as cópias. `anti-entropy-read-repair-and-merkle-tree-synchronization` mostrou como duas réplicas descobrem o que difere. `cassandra-distributed-architecture-gossip-tokens-vnodes` mostrou uma troca de gossip em produção. Nenhuma das duas responde à pergunta de fundo: se cada nó conversa com um parceiro aleatório, com que velocidade a informação se espalha, quanto isso custa e o que pode dar errado?

A resposta vem de Demers e colegas, na Xerox PARC, que estudaram os servidores de nomes Clearinghouse na Xerox Corporate Internet. No início de 1986, muitos dos problemas de desempenho daquela rede foram atribuídos ao tráfego gerado para manter consistentes os domínios muito replicados. A anti-entropy era seguida de um passo de remailing: sempre que dois sites discordavam, o valor correto era enviado por mail a todos os sites. Para um domínio guardado em 300 sites, o artigo relata que 90.000 mensagens podiam entrar na rede a cada noite, ou seja, 300 ao quadrado. Isso estava muito além da capacidade da rede, e mail, transferência de arquivos e consulta de nomes caíram junto. A solução não veio de uma entrega confiável melhor. Veio de tratar a propagação como uma epidemia que dá para projetar, e não apenas suportar.

## Teoria Central

### Três estratégias

```text
DIRECT MAIL:     o site de entrada envia cada atualização a todos. n mensagens,
                 rápido, mas mail se perde e o remetente pode não conhecer todos.
ANTI-ENTROPY:    cada site escolhe regularmente um site aleatório e resolve com
                 ele todas as diferenças. Muito confiável, examina o banco todo.
RUMOR MONGERING: um site com uma atualização "quente" continua contando a sites
                 aleatórios e para quando muitos já sabiam. Barato, pode falhar.
```

O artigo empresta o vocabulário da epidemiologia, por atualização: um site é **susceptible** se não tem a atualização, **infective** se a tem e está compartilhando, e **removed** se a tem e parou de compartilhar. Anti-entropy é uma **simple epidemic**, sem estado removed. Rumor mongering é uma **complex epidemic**.

### Anti-entropy: push, pull, push-pull

Com timestamps decidindo qual valor é mais novo, `ResolveDifference[s, s']` tem três formas: **push** copia de `s` para `s'` quando `s` é mais novo, **pull** copia de `s'` para `s` quando `s'` é mais novo, e **push-pull** faz o que couber. Partindo de um site infectado, uma simple epidemic alcança todos em tempo esperado proporcional a `log n`. Para push, o artigo cita a forma exata `log2(n) + ln(n) + O(1)`.

As estratégias se separam de verdade na cauda. Seja `p_i` a probabilidade de um site continuar susceptible depois do ciclo `i`:

```text
pull:  p_{i+1} = p_i^2                      o site só continua sem saber se
                                            contatar outro site que não sabe
push:  p_{i+1} = p_i (1 - 1/n)^(n(1-p_i))   nenhum site infective o escolheu
       o que dá cerca de p_i / e quando p_i é pequeno
```

Pull eleva o resto ao quadrado, enquanto push o divide por uma constante. Por isso, quando anti-entropy serve de reserva para outro mecanismo e só poucos sites estão atrasados, o artigo conclui que pull ou push-pull são muito preferíveis, e que push-pull se comporta essencialmente como pull.

Comparar bancos inteiros é o custo. As mitigações do artigo são checksums, uma lista de atualizações recentes cobrindo uma janela maior que o tempo esperado de propagação, e o "peel back" em ordem reversa de timestamp. A comparação por Merkle tree nos stores estilo Dynamo é uma resposta posterior ao mesmo custo.

### Rumor mongering e suas três métricas

No rumor básico, um site ativo liga para um site aleatório e, depois de uma ligação desnecessária, perde o interesse com probabilidade `1/k`. Modelando as frações `s`, `i`, `r` com equações diferenciais e resolvendo `i(s)`, chega-se a um residue final que satisfaz `s = e^(-(k+1)(1-s))`, cerca de 20% com `k = 1` e 6% com `k = 2`. O projeto é julgado por três números:

- **Residue**: o valor de `s` quando `i` chega a zero.
- **Traffic**: `m`, atualizações enviadas divididas pelo número de sites.
- **Delay**: `t_ave`, a média entre os sites, e `t_last`, para o último site alcançado.

As variações são **blind vs feedback** (perder o interesse sem olhar o destinatário, ou só se ele já sabia) e **coin vs counter** (com probabilidade `1/k`, ou depois de `k` contatos desnecessários). O resultado surpreendente é que todas seguem a mesma lei em push, `s = e^-m`: são `nm` atualizações enviadas, e um site perde todas com probabilidade `(1 - 1/n)^(nm)`. Essa lei vem com uma ressalva: como `m` não é constante, ela depende de os momentos da sua distribuição irem a zero quando `n` cresce, o que o artigo observou empiricamente, mas não provou. Ela também supõe ausência de limite de conexões, já que push com limite de um deve se comportar como `s = e^(-lambda m)` com `lambda = 1/(1 - 1/e)`. Dentro da lei, só o delay separa as variantes, e counters pesam mais que feedback.

Rumores em pull fazem melhor que `s = e^-m`, e a recorrência do artigo para counter com feedback exibe `s = e^(-Theta(m^3))`. O preço é o custo ocioso: num banco quieto, push para de gerar tráfego, enquanto pull continua enviando pedidos inúteis.

### Quando um rumor morre, e quando um dado precisa morrer

Uma complex epidemic roda até a quiescência. Se `i` chega a zero com sites ainda susceptible, o sistema fica num estado estável em que só alguns sites conhecem a atualização. Rodar anti-entropy de vez em quando elimina esse desfecho: toda atualização passa a chegar a todo site, ou a ser superada nele, com probabilidade 1.

Remoção pede mecanismo próprio. Apagar a cópia local não adianta nada, porque a propagação ressuscita o item a partir de outros sites. Itens removidos são substituídos por **death certificates**, entradas com timestamp que se espalham como dados. Mantê-los por um tempo fixo (o exemplo do artigo é 30 dias) troca espaço por risco de ressurreição. Certificados **dormant**, guardados por poucos sites e reativados quando surge uma cópia obsoleta, ampliam esse histórico.

### A escolha do parceiro é onde mora o custo

A escolha uniforme parece grátis na análise, mas na rede da Xerox um par de enlaces transatlânticos era a única rota entre Europa e América do Norte. Na simulação do artigo de anti-entropy push-pull nessa topologia (Tabela 4), o enlace para Bushey, na Inglaterra, teve 75,7 comparações por ciclo com escolha uniforme, contra uma média de 5,9 em todos os enlaces. Escolher parceiros com probabilidade decrescente na posição por distância (`a = 2.0` na distribuição do artigo) derrubou Bushey para 2,4, enquanto `t_last` piorou de 7,8 para 13,3 ciclos. Uma distribuição `1/Q(d)^2`, em que `Q(d)` conta os sites até a distância `d`, foi implantada na rede inteira, com o que o artigo chama de melhorias dramáticas.

A escolha uniforme também supõe que o nó conhece a membership. Jelasity e colegas argumentam que uma tabela completa de membros é irrealista num sistema grande e dinâmico, e isolam um **peer-sampling service**: cada nó guarda uma visão parcial pequena e a renova fazendo gossip da própria membership. Os resultados deles também favorecem push-pull, já que só push ou só pull pode particionar os nós.

## Exemplos Resolvidos

Todas as execuções abaixo vêm de uma simulação em rodadas feita para esta lição: `n` sites, parceiros uniformes, e nenhum site age sobre uma novidade recebida no mesmo ciclo.

### Exemplo 1: espalhando uma atualização por anti-entropy

```text
n = 1000, um site infectado, 2000 execuções
estratégia  ciclos (média)   percentil 99
push        18,0             22
pull        13,8             18
push-pull    9,2             10

Sites infectados por ciclo, uma execução de cada:
push       1 2 4 8 16 32 63 120 216 364 546 737 870 943 977 992 997 1000
pull       1 2 5 9 20 44 90 174 315 523 790 962 997 1000
push-pull  1 3 9 28 83 235 541 879 993 1000

Ciclos médios de push vs log2(n) + ln(n):
n = 100: 12,4 vs 11,2     n = 1000: 18,0 vs 16,9
n = 10^4: 23,7 vs 22,5    n = 10^5: 29,4 vs 28,1
```

A diferença fica perto de 1,2 enquanto `n` cresce 1000 vezes, e esse é o termo `O(1)`. As caudas mostram as recorrências. Push deixa 57, 23, 8, 3, 0 sites, perto de dividir por `e` (57, 21, 8, 3). Pull deixa 210, 38, 3, 0, enquanto elevar ao quadrado prevê 210, 44, 2.

### Exemplo 2: anti-entropy como reserva

```text
n = 1000, 990 sites já infectados, 5000 execuções
estratégia  ciclos (média)   pior execução
push        3,45             15
pull        1,09              2
push-pull   1,03              2

Recorrência a partir de p = 0,01, sites restantes esperados após um ciclo:
pull 0,1      push 3,7
```

Este é o caso que interessa ao artigo: direct mail ou um rumor já fez quase todo o trabalho. Push dispara 990 tiros aleatórios em 10 alvos a cada ciclo. Pull faz cada um dos 10 perguntar a um site aleatório, e quase todo site já sabe.

### Exemplo 3: reproduzindo a tabela de rumor do artigo

Rumor em push, feedback e counter, `n = 1000`, 3000 execuções. O counter zera num contato útil. O artigo declara essa regra na nota sobre pull, e a boa concordância aqui sugere a mesma regra para push.

```text
 k | residue s       | traffic m    | e^-m    | t_last
   | sim     Tab. 1  | sim   Tab. 1 | de m    | sim   Tab. 1
 1 | 0,175   0,18    | 1,74  1,7    | 0,175   | 16,8  16,8
 2 | 0,037   0,037   | 3,30  3,3    | 0,037   | 17,0  16,9
 3 | 0,011   0,011   | 4,53  4,5    | 0,011   | 17,3  17,4
 4 | 0,0035  0,0036  | 5,64  5,6    | 0,0036  | 17,6  17,5
 5 | 0,0013  0,0012  | 6,68  6,7    | 0,0013  | 17,7  17,7

Blind e coin, k = 5 (2000 execuções):
residue 0,0071 (Tabela 2: 0,008), m = 4,96 (4,9), t_last 32,5 (32)
```

A partir de `k = 2`, cada unidade a mais de `k` compra um fator de cerca de 3 no residue por pouco mais de uma atualização extra por site, com `t_last` quase parado. Compare `k = 3` com blind coin em `k = 5`: o tráfego é parecido (4,53 e 4,96) e o residue obedece à mesma lei, mas o último site ouve 15 ciclos depois. É esse o ponto do artigo: delay é a única coisa que distingue essas variantes.

### Exemplo 4: um rumor com pull anti-entropy de reserva

```text
n = 1000, rumor com k = 2, depois pull anti-entropy, 3000 execuções
atualizações enviadas pelo rumor   3299 em média
sites perdidos pelo rumor          37 em média, 68 no pior caso, nunca 0
ciclos de pull até terminar        1,73 em média, 3 no pior caso
```

O rumor fez quase toda a propagação, e mesmo assim nenhuma das 3000 execuções alcançou todos os sites, o que combina com um residue de 0,037 em 1000 sites. A anti-entropy então termina em cerca de dois ciclos, pelo motivo do Exemplo 2. O tráfego do rumor é um múltiplo pequeno de `n`. A seção 1.5 do artigo faz o ponto correspondente sobre redistribuição: reenviar por mail uma atualização entregue pela metade pode gerar `O(n^2)` mensagens, enquanto redistribuí-la como rumor reduziria muito o custo esperado.

## Equívocos Comuns e Armadilhas

- **"Gossip" é o nome de um algoritmo só.** Anti-entropy nunca para e converge com probabilidade 1. Rumor mongering para de propósito e tem residue. Uma troca de estado por timer que roda para sempre, como o gossiper de `cassandra-distributed-architecture-gossip-tokens-vnodes`, se comporta como simple epidemic, não como rumor.
- **"Aumentar `k` deixa o rumor mais lento."** O Exemplo 3 mostra `t_last` indo só de 16,8 para 17,7 ciclos enquanto o residue cai duas ordens de grandeza.
- **"Ciclos logarítmicos significam barato."** Ciclo não é custo. Um ciclo de anti-entropy compara bancos, e a escolha uniforme concentrou 75,7 comparações por ciclo num enlace só. O remailing transformou um processo logarítmico em `n` ao quadrado mensagens.
- **"Um rumor que chegou a 96% termina sozinho."** Quando todos os sites estão removed, não acontece mais nada. Os sites restantes ficam defasados até vir anti-entropy ou uma atualização nova.
- **"Apagar a linha basta."** Sem death certificate, a anti-entropy trata a cópia que sobrou em outro site como dado novo e a restaura.
- **"Parceiros aleatórios uniformes são de graça."** Eles exigem uma visão de membership e ignoram a topologia.

## Resumo

Direct mail é rápido e pouco confiável, anti-entropy é confiável e cara, e rumor mongering é barato e pode deixar sites de fora. O que rodou na rede da Xerox foi direct mail com anti-entropy ajustada espacialmente. Rumor mongering com anti-entropy de reserva continuou sendo a proposta do artigo, que "shows promise as an efficient replacement" para o passo de mail, e se mostrou sensível à topologia: numa distribuição espacial, rumores em push precisaram de `k = 36`. Anti-entropy alcança todos em tempo logarítmico, e na cauda pull eleva o resto ao quadrado enquanto push só o divide por `e`. Em rumores push sem limite de conexões, as variantes blind, feedback, coin e counter seguem `s = e^-m`, relação observada empiricamente e não provada, então é o delay que as separa. Remoção exige death certificates, e a escolha uniforme de parceiro precisa ser temperada pela topologia e fornecida por algum mecanismo de membership. A próxima lição, `unstructured-p2p-flooding-super-peers-and-bittorrent`, leva a mesma ideia de vizinho aleatório de réplicas que querem toda atualização para peers que querem um arquivo.

## Documentation Links

- [Demers et al.: Epidemic Algorithms for Replicated Database Maintenance (Xerox PARC CSL-89-1, 1989)](https://ftp.mirrorservice.org/sites/www.bitsavers.org/pdf/xerox/parc/techReports/CSL-89-1_Epidemic_Algorithms_for_Replicated_Database_Maintenance.pdf): a versão em relatório do artigo do PODC, com o histórico do Clearinghouse, as recorrências de push e pull, as Tabelas 1 a 5, death certificates e distribuições espaciais.
- [Demers et al.: Epidemic Algorithms for Replicated Database Maintenance (PODC 1987)](https://none.cs.umass.edu/~shenoy/courses/fall04/readings/demers.pdf): cópia digitalizada do artigo original da conferência.
- [Jelasity et al.: Gossip-based Peer Sampling (ACM TOCS, 2007)](https://www.distributed-systems.net/my-data/papers/2007.tocs.pdf): o peer-sampling service, visões parciais mantidas por gossip e por que push-pull é favorecido.
