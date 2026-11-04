---
version: 1.0
updatedAt: 2026-11-04
title: "Consistência Causal Transacional"
summary: "Leituras de uma chave por vez não dão visão consistente de várias chaves, nem com causalidade. O COPS-GT acrescenta transações só de leitura em até duas rodadas, e o Cure define a Consistência Causal Transacional: transações interativas sobre snapshots causalmente consistentes, com visibilidade atômica e convergência por CRDTs. O modelo abre mão de invariantes entre transações concorrentes, de parte do frescor e de escritas recentes de um datacenter perdido."
---
## Objetivos de Aprendizagem

- Explicar por que um store causal ainda entrega leituras inconsistentes de várias chaves quando usadas gets de uma chave, e por que nenhuma ordem fixa de leitura resolve.
- Acompanhar as duas rodadas de uma transação de leitura do COPS-GT e dizer por que a segunda rodada pede versões explícitas.
- Definir a Consistência Causal Transacional por meio de snapshots causalmente consistentes, visibilidade atômica e tipos de dados convergentes.
- Seguir a regra do Cure para tornar visível uma transação remota, e listar de forma concreta do que os sistemas nesse modelo abrem mão.

## Contexto e Motivação

`causal-consistency` ordenou leituras e escritas individuais, mas um álbum tem lista de acesso e um post tem comentários. Um store pode ser perfeitamente causal e ainda assim entregar a um cliente dois valores que nunca coexistiram, porque o cliente os leu em dois momentos. A solução é uma transação, mas `two-phase-commit-and-the-blocking-problem` e a latência de longa distância tornam transações serializáveis comuns uma escolha ruim para um sistema que precisa responder localmente durante uma partição. A consistência causal transacional mantém as transações e abandona a ordem única exigida em `sequential-consistency-and-why-it-is-weaker`.

## Teoria Central

### Uma chave por vez não basta

Lloyd et al. dão o caso motivador. Alice restringe a ACL do álbum aos amigos e depois adiciona fotos pessoais. Um leitor que busca a ACL, confere e só então busca o álbum pode combinar a ACL pública antiga com o álbum privado. Ler o álbum primeiro também falha: Alice pode depois apagar as fotos e reabrir a ACL, e o leitor junta o álbum privado com a ACL pública. Nas palavras do paper, não existe ordem canônica correta para as chaves. O Exemplo 1 confirma isso por enumeração.

### Transações só de leitura: `get_trans`

O COPS-GT guarda uma lista de dependências em cada versão e mantém versões antigas. O `get_trans` roda em no máximo duas rodadas de requisições locais:

```text
Rodada 1: pega a versão mais recente de cada chave pedida, em paralelo.
          Para cada resultado, para cada dependência em chave pedida:
            ccv[chave] = max(ccv[chave], versão da dependência)
Rodada 2: para cada chave cujo resultado é mais velho que ccv[chave]:
            get_by_version(chave, ccv[chave])
```

Duas propriedades do causal+ garantem o término. A versão pedida já está presente localmente, porque as dependências de uma versão visível sofreram commit antes. Ela também não traz dependências novas, já que dependências são transitivas e a primeira rodada já as viu. Pedir a versão mais recente na segunda rodada estragaria isso, pois versões mais novas poderiam continuar trazendo dependências mais novas.

O preço é estado. O COPS-GT mantém versões antigas por `trans_time`, 5 segundos na implementação, então a 105 MB/s de escrita um nó pode reter 525 MB de versões antigas. A coleta de lixo de dependências nas versões mais novas também para durante uma partição, o que o paper lista como limitação.

### O modelo transacional

Akkoorath et al. chamam transações só de leitura mais transações só de escrita de TCC-S, o modelo que atribuem ao Eiger. Manter as duas separadas significa que um cliente não consegue ler um objeto e atualizá-lo na mesma transação. A Consistência Causal Transacional deles permite transações interativas com estas propriedades:

- **Snapshot causalmente consistente.** As versões a_i e b_j pertencem ao mesmo snapshot, a menos que alguma outra versão a_k tenha sido criada depois de a_i e esteja causalmente antes de b_j. Uma transação lê de um snapshot assim, que inclui os efeitos de todas as transações causalmente anteriores.
- **Atomicidade.** Todas as atualizações de uma transação ficam visíveis juntas, ou nenhuma fica.
- **Convergência por CRDTs.** Atualizações concorrentes se fundem conforme o tipo, por exemplo add e remove de um conjunto, em vez de depender só de last-writer-wins.

### Como o Cure faz isso funcionar

O Cure carimba cada transação com um **commit vector clock**, uma entrada por datacenter. Cada partição m do datacenter d mantém `pvc`, que registra até onde ela recebeu atualizações de cada datacenter. As partições trocam `pvc` em background, e o mínimo entrada a entrada é o **globally stable snapshot**, GSS: tudo que se sabe disponível em todas as partições do datacenter local.

```text
Início:  svc = GSS, exceto svc[d] = max(cvc[d] do cliente, relógio local)
Leitura: espera a partição alcançar svc[d], depois retorna
         a versão mais nova com commit vector <= svc
Commit:  2PC entre as partições atualizadas do datacenter LOCAL.
         Cada uma propõe seu relógio, e commit time = máximo.
         ct = svc com ct[d] = commit time
Remoto:  atualizações entram no log ao chegar e só ficam visíveis
         quando o GSS passa do commit vector delas
```

Tomar o máximo importa. Um commit time menor poderia ficar abaixo do prepare time de um participante, e um leitor com snapshot nesse intervalo não esperaria a transação e a perderia. Como todas as atualizações de uma transação compartilham um commit vector e as leituras esperam o mesmo snapshot em cada partição, o leitor vê todas ou nenhuma. Os relógios só precisam de sincronização frouxa: o skew afeta desempenho, não correção.

Um único escalar seria menor, e Akkoorath et al. comparam com o GentleRain, que usa um. O argumento deles a favor do vetor é o comportamento sob falha: com escalar, a visibilidade remota acompanha o datacenter mais distante, e um datacenter desconectado congela as atualizações de todos os remotos. Com vetor, só as atualizações do datacenter desconectado congelam. O [Saturn](/papers/saturn-distributed-metadata-service-for-causal-consistency) ataca o mesmo trade-off de metadados por outra direção, em `causal-metadata-for-geo-replication-saturn`.

### Do que se abre mão

A tabela de comparação do Cure coloca o modelo diante de outros mais fortes (x significa anomalia proibida):

```text
                  SER  SI   PSI/NMSI  Cure  TCC-S  EC
Transações        yes  yes  yes       yes   RO,WO  no
Short fork        x    ok   ok        ok    ok     ok
Long fork         x    x    ok        ok    ok     ok
Convergent fork   x    x    x         ok    ok     ok
Convergência      -    -    -         CRDT  LWW    LWW
```

Short fork é write skew, long fork deixa dois observadores verem duas transações concorrentes em estados opostos, e convergent fork deixa transações concorrentes atualizarem o mesmo item e se fundirem. Na prática, esses sistemas abrem mão de:

- **Invariantes entre transações concorrentes.** Nada impede que dois datacenters aprovem, cada um, uma ação legal isoladamente e ilegal em conjunto, como mostra o Exemplo 3.
- **Frescor.** Atualizações remotas esperam estabilidade. O Cure mediu em média de 80 a 90 ms de latência de visibilidade remota com 50 ms injetados entre datacenters.
- **Escritas recentes quando um datacenter morre.** Lloyd et al. afirmam que atualizações ainda não copiadas para fora de um datacenter que falhou se perdem, custo inevitável de commits locais de baixa latência. O paper do Cure não diz isso, mas o mesmo raciocínio se aplica a ele, porque o commit retorna antes de as atualizações se propagarem.
- **Parte do throughput.** No benchmark do Cure com registradores LWW, a consistência eventual ficou cerca de 30 por cento acima dele em todas as cargas.
- **A espera não some.** Leituras podem esperar uma partição alcançar o snapshot, e um cliente cujo `cvc` está à frente do GSS bloqueia ao iniciar uma transação. O commit dentro de um datacenter é 2PC, e as falhas que o paper discute são falhas de datacenter e partições entre datacenters.

Akkoorath et al. chamam a TCC de "the strongest semantics a system can achieve under high-availability and low-latency". Eles citam Attiya, Ellen e Morrison para a afirmação sobre operações individuais, e a seção de correção do paper argumenta apenas que o Cure implementa TCC. A afirmação transacional é a posição dos autores, e o paper não traz prova de otimalidade.

## Exemplos Resolvidos

Cada resultado abaixo cobre todos os escalonamentos descritos. Os valores de relógio do Exemplo 2 são inventados para ilustração e não vêm do paper.

### Exemplo 1: a corrida da ACL, enumerada

Comece com ACL v1 pública e Album v1 limpo. Alice emite quatro escritas: ACL v2 friends, Album v2 pessoal (depende de ACL v2), Album v3 limpo (depende de Album v2), ACL v3 pública (depende de Album v3). Um passo conta as escritas já aplicadas. Um resultado proibido junta ACL pública com álbum pessoal.

```text
Dois gets simples, cada leitura em qualquer passo (15 escalonamentos):
  ACL e depois Album:  1 proibido (ACL lida no passo 0, Album no 2)
  Album e depois ACL:  1 proibido (Album lido no passo 2, ACL no 4)

get_trans (55 escalonamentos de duas leituras na rodada 1 e uma rodada 2):
  pares crus proibidos na rodada 1:  2 de 25
  resultados finais proibidos:       0
  escalonamentos que usam a rodada 2: 9

Reparo de uma corrida:
  rodada 1: ACL v1 pública, Album v2 pessoal, que exige ACL >= 2
  rodada 2: get_by_version(ACL, 2) retorna friends
  resultado: ACL v2 friends, Album v2 pessoal
```

Cada ordem sequencial falha num escalonamento diferente.

### Exemplo 2: quando uma transação remota aparece no Cure

O datacenter A tem as partições p1 e p2. A transação T, do datacenter B, escreve x em p1 e y em p2, com entrada de commit B = 120.

```text
Início        p1.pvc[B]=0    p2.pvc[B]=0    GSS[B]=0
              leitura x=init, y=init
p1 recebe T   p1.pvc[B]=120  p2.pvc[B]=0    GSS[B]=0
              leitura x=init, y=init   (x guardado, mas invisível)
p2 recebe T   p1.pvc[B]=120  p2.pvc[B]=120  GSS[B]=120
              leitura x=T, y=T         (os dois aparecem juntos)

Datacenter C particionado: pvc[B]=300, pvc[C]=90 nas duas partições.
  GSS = {B: 300, C: 90}
  atualização de B no tempo 200, entrada de C no snapshot <= 90,
  regra vetorial:                                 visível (200 <= 300, entrada de C <= 90)
  mesma atualização, escalar min(300, 90)=90:     invisível
```

A linha do escalar é um modelo simplificado do comportamento que o paper descreve para o GentleRain.

### Exemplo 3: uma conta bancária sob TCC

Saldo 100. T1 e T2, em datacenters diferentes, leem 100 dos seus snapshots e cada uma saca 80 se o saldo permitir.

```text
Serial T1,T2 ou T2,T1:   um saque recusado, final 20
Sob TCC, ambas fazem commit:  80 + 80 = 160 pagos
  fusão em registrador LWW:   final 20   (uma atualização perdida)
  fusão em contador CRDT:     final -60  (nada perdido, invariante quebrado)

Write skew, x=y=1. T1 lê y, faz x=0. T2 lê x, faz y=0.
Observado: ambas leram 1.
  a ordem T1,T2 daria a T2 uma leitura de 0
  a ordem T2,T1 daria a T1 uma leitura de 0
Nenhuma ordem serial explica isso.
```

Os dois snapshots eram causalmente consistentes e o CRDT convergiu. Nenhuma das garantias fala do invariante.

## Equívocos Comuns e Armadilhas

- **"Ler várias chaves de um store causal dá uma visão consistente."** O Exemplo 1 mostra pares proibidos nas duas ordens de leitura, num store causal do início ao fim.
- **"Snapshot significa snapshot isolation."** Sob SI, escritores concorrentes do mesmo item conflitam e existe uma ordem total de atualizações. A TCC permite long forks e convergent forks, e por isso a tabela do Cure a coloca abaixo de SI, PSI e NMSI.
- **"CRDTs tornam seguras as atualizações concorrentes."** Eles garantem convergência. O Exemplo 3 converge para -60. Um CRDT funde efeitos e nunca rejeita um deles.
- **"Esses sistemas nunca coordenam."** Eles evitam coordenação entre datacenters no caminho do commit. O Cure ainda roda 2PC entre partições de um mesmo datacenter.

## Resumo

Consistência causal por chave não dá visão consistente de várias chaves, qualquer que seja a ordem de leitura. O COPS-GT acrescenta transações só de leitura em até duas rodadas, guardando dependências junto das versões. A Consistência Causal Transacional, definida com o Cure, oferece transações interativas que leem de snapshots causalmente consistentes, com visibilidade atômica e convergência por CRDTs. O Cure faz isso com commit vector clocks e um globally stable snapshot que decide quando transações remotas aparecem. O modelo abre mão de invariantes entre transações concorrentes, de parte do frescor, de escritas recentes num datacenter perdido e, em registradores LWW, de parte do throughput da consistência eventual. A pretensão de ser o modelo transacional disponível mais forte é posição dos autores, não um limite provado.

## Documentation Links

- [Akkoorath et al.: Cure: Strong Semantics Meets High Availability and Low Latency (ICDCS 2016)](https://webperso.info.ucl.ac.be/~pvr/icdcs2016-cure.pdf): a definição de TCC, a Tabela I, os Algoritmos 1 e 2, o argumento dos vector clocks e os números da avaliação.
- [Lloyd, Freedman, Kaminsky and Andersen: Don't Settle for Eventual (SOSP 2011)](https://www.cs.cmu.edu/~dga/papers/cops-sosp2011.pdf): o exemplo da ACL, o `get_trans`, os custos de coleta de lixo e o comportamento sob falha de datacenter.
- [Bravo, Rodrigues and Van Roy: Saturn: a Distributed Metadata Service for Causal Consistency (EuroSys 2017)](https://webperso.info.ucl.ac.be/~pvr/p111-Bravo.pdf): um serviço de metadados que separa metadados causais da disseminação de dados.
