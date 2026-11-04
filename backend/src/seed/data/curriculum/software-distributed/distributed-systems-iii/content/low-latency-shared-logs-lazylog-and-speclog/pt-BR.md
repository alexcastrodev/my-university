---
version: 1.0
updatedAt: 2026-11-04
title: "Shared Logs de Baixa Latência: LazyLog e SpecLog"
summary: "Como reduzir o custo de ordenação de um shared log sem abrir mão da ordem total: o LazyLog confirma o append antes de existir posição e fixa a ordem em segundo plano, antes que ela possa ser lida, e o SpecLog entrega registros numa ordem prevista para o consumidor computar enquanto a coordenação acontece, com a confirmação ainda limitando o que pode sair para fora."
---
## Objetivos de Aprendizagem

- Separar os três momentos que um shared log eager funde (o registro está durável, tem posição, um consumidor pode usá-lo) e dizer qual momento o LazyLog e o SpecLog movem.
- Explicar por que escritas sem coordenação em todas as réplicas de sequenciamento ainda contêm uma ordem linearizável, e por que a regra do `stable-gp` impede que essa ordem mude depois de um crash.
- Manter três nomes separados (SpecLog é a abstração, fix-ante ordering é o mecanismo, Belfast é o sistema) e calcular as posições previstas de um shard a partir de cortes predeterminados.
- Dizer quanto cada projeto custa e sob quais condições valem os números publicados.

## Contexto e Motivação

`scaling-shared-logs-fuzzylog-and-scalog` mostrou como shards que reportam em lotes deixam um log escalar, e `stateful-serverless-on-shared-logs-boki-and-flexlog` construiu aplicações sobre esse projeto. O preço é espera: um registro passa por replicação, lote e corte global antes que qualquer coisa aconteça com ele.

Dois papers posteriores, com autores em comum, atacam essa espera por pontas opostas. O [LazyLog](/papers/lazylog-shared-log-abstraction-for-low-latency-applications) (SOSP 2024) atende escritores que querem uma confirmação rápida. O [SpecLog](/papers/speclog-low-latency-speculative-shared-log-fix-ante-ordering) (OSDI 2025) atende consumidores que querem os registros cedo. Nenhum dos dois elimina a ordenação. Cada um a move para onde um tipo de aplicação não precisa esperar por ela.

## Teoria Central

### Três momentos, e quem move o quê

```text
              ack ao escritor     consumidor recebe       consumidor pode agir
Scalog        após corte global   após corte global       após computar
LazyLog       antes de ordenar    após ordem estável      após computar
SpecLog       após corte global   já durável, previsto    após confirmação
```

### LazyLog: confirmar antes de a posição existir

No LazyLog, `append` torna o registro durável e promete que ele será ligado mais tarde à sua posição linearizável. A chamada devolve um indicador de sucesso, não uma posição. A ligação é imposta antes que uma posição possa ser lida, então os leitores continuam vendo uma única sequência linearizável. A aposta do paper é que aplicações como bancos com leitores desacoplados, journals e registro de atividade precisam da ordem na hora de consumir, e que seus leitores andam atrás dos escritores. O argumento vem de como essas aplicações funcionam, não de atraso de leitura medido.

Os clientes escrevem em paralelo em todas as réplicas de sequenciamento (em geral f + 1 para tolerar f falhas), sem coordenação entre elas, e o append termina em um round trip. A ordem sobrevive por causa da condição de tempo real de `linearizability-a-rigorous-definition`: se `b` começa depois que `a` terminou, `a` já está em todas as réplicas, então `b` cai depois de `a` em todos os logs. Só appends concorrentes podem divergir, e qualquer ordem entre eles é legal. Logo, o log de qualquer réplica é uma ordem válida. Usa-se o do líder normalmente e o de uma sobrevivente depois de um crash.

Em segundo plano, o líder atribui posições a partir de `last-ordered-gp + 1` e empurra os registros para os shards. Quando os shards os têm, cada réplica de sequenciamento faz garbage collection e avança `last-ordered-gp`. Só então o `stable-gp` avança. Os shards servem leituras só até o `stable-gp`, e uma leitura além dele espera: é o que o paper chama de slow path.

Dois sistemas implementam a abstração. O Erwin-■ trata os shards como caixas-pretas, então todo dado passa pela camada de sequenciamento: cerca de 1M appends/s com registros de 100 bytes, estagnando com registros maiores. O Erwin-st manda só metadados por ali e escreve os dados direto em shards modificados: cerca de 700K appends/s com registros de 4KB em 10 shards.

### Quanto o LazyLog custa

- **Escrever em todas as réplicas.** Qualquer falha de réplica de sequenciamento força uma reconfiguração, e réplicas lentas pioram a latência de cauda.
- **Escala.** O Erwin-st escala como o Corfu, não como o Scalog.
- **Ler logo depois de escrever.** Máquinas de estado replicadas sobre um log, o padrão de `the-shared-log-abstraction-corfu-tango-and-vcorfu`, leem até a cauda logo após o append, então pagam no caminho de leitura.

O ganho no append, até 3,8× abaixo do Corfu com a mesma vazão e registros de 4KB, combina com a contagem de round trips: 1 contra os 4 do Corfu com três réplicas. Leituras com 3 ms de atraso ficam perto do Corfu. Sem atraso, 45K operações/s ainda rendem lotes grandes o bastante para deixar as leituras só um pouco mais lentas, mas a 5K quase todas caem no slow path, acima do custo de append de 70 µs do Corfu. Os autores atribuem esse excesso ao ajuste para lotes grandes. As duas ordens de grandeza sobre o Scalog comparam com o artefato público dele, que usa gRPC onde o Erwin usa eRPC, e os autores admitem que um Scalog melhor teria latências absolutas menores.

### SpecLog, fix-ante ordering, Belfast

**SpecLog é a abstração.** `deliver(r, pos, is_spec)` entrega um registro com um indicador de que a posição é uma previsão, e depois vem `confirm_spec(k)` ou `fail_spec(k)`. Os consumidores computam de imediato, seguram saídas externas até a confirmação e fazem rollback em caso de falha, de modo que a computação se sobrepõe à coordenação. Os appends continuam sendo confirmados só depois do corte real. Confirmar antes quebraria a linearizabilidade, porque um append posterior em outro shard poderia ficar com uma posição menor.

**Fix-ante ordering é o mecanismo.** No Scalog um shard pode reportar quantos registros quiser, então nenhum outro shard sabe onde os seus vão cair. O fix-ante ordering troca esse livre-arbítrio por cortes predeterminados, que dão a cada shard uma quota por corte. Um shard com registros de menos acrescenta no-ops, e um com registros de mais os adia. Os cortes reais continuam vindo depois da durabilidade e coincidem com as previsões enquanto as quotas forem cumpridas.

**Belfast é o sistema.** Ele define quotas pelas taxas de ingestão. O seu lag fix pede relatórios extras aos shards atrasados durante um pico. Janelas de lease de especulação com W cortes confinam mudanças de quota e de membros às fronteiras da janela, para que todos os shards prevejam a partir dos mesmos cortes. O fix-ante ordering também tem um custo que o Scalog não tem: o sequenciador segura o corte até que todo shard com quota reporte, por isso o Belfast dá quota zero a shards lentos. Quando um shard inteiro falha, a especulação falha e os consumidores recomputam.

O resultado principal do Belfast é medido contra um Scalog alterado para que só o primário reporte, com registros de 4KB e 1,5 ms de computação, em 2 e 4 shards: entrega de 3,2× a 3,5× mais cedo e latência ponta a ponta média 1,6× menor. No p99 o ganho é de 1,4× e 1,17×. A sobrecarga no append é de 5,8% com 10 shards.

## Exemplos Resolvidos

### Exemplo 1: uma ordem linearizável dentro de três logs que discordam

```text
Append  início  fim   (cliente espera as 3 réplicas, em µs)
a       0       24
b       40      72
c       41      69

Ordem de chegada com atrasos de rede por réplica:
L  (líder)  a c b
F1          a b c
F2          a b c

a termina (24) antes de b e c começarem: a precede ambos em todos os logs.
b e c se sobrepõem: L discorda de F1 e F2, e isso é legal.
```

Todo log respeita as únicas restrições de tempo real que existem, então cada um é uma ordem válida.

### Exemplo 2: por que o `stable-gp` espera o garbage collection

As posições de 1 a 3 estão estáveis. O líder empurra `4:a, 5:c, 6:b` para os shards e cai, e F1 descarrega o próprio log a partir da posição 4.

```text
Regra errada, stable-gp = 6 antes do GC nos seguidores:
  leitor viu   4:a 5:c 6:b
  após F1      4:a 5:b 6:c   conflito nas posições 5 e 6
Regra certa, stable-gp fica em 3 até o GC nos seguidores:
  leitor viu   nada acima de 3 (ele espera)
  após F1      4:a 5:b 6:c   sobrescrever é seguro
```

Expor uma ordem e torná-la permanente precisa ser um passo só.

### Exemplo 3: posições com fix-ante

As quotas são 2, 3 e 2, então os cortes predeterminados são ⟨2,3,2⟩, ⟨4,6,4⟩, ⟨6,9,6⟩. As posições seguem a ordem lexicográfica dos shards.

```text
Corte 1:  S1 [1,2]    S2 [3,4,5]     S3 [6,7]
Corte 2:  S1 [8,9]    S2 [10,11,12]  S3 [13,14]

Livre-arbítrio: S2 espera 8,9 para S1 e prevê 10.
                S1 reporta 3 registros. O de S2 cai em 11. Errado.

Fix-ante, segundo relatório, com 3, 2, 1 registros recebidos:
  S1 envia 2, adia 1       S2 envia 2, falta 1
  S3 envia 1, soma 1 no-op
```

O próximo registro de S2 fica em 10, não importa quanto S1 tenha recebido. Se nada chegar para a terceira vaga, S2 também a preenche com um no-op.

### Exemplo 4: por que o ganho tem um pico

Um modelo simples, que não vem do paper, com latências inventadas: durável em 0,6 ms, corte real 1,5 ms depois. O Scalog termina em `0,6 + 1,5 + c`. Um consumidor especulativo termina em `max(0,6 + c, 2,1)`, porque precisa esperar a confirmação.

```text
computação c (ms)  0,5   1,0   1,5   2,0   4,0   50
Scalog             2,6   3,1   3,6   4,1   6,1   52,1
especulativo       2,1   2,1   2,1   2,6   4,6   50,6
ganho              1,24  1,48  1,71  1,58  1,33  1,03
```

O pico fica onde a computação iguala o atraso de ordenação. Abaixo dele, o consumidor espera a confirmação. Acima dele, a ordenação é uma fatia pequena do total. A curva medida do Belfast tem a mesma forma: 1,17× com 0,5 ms, 1,63× com 1,5 ms, 1,3× com 4 ms, aproximando-se de 1 com 50 ms.

## Equívocos Comuns e Armadilhas

- **"O LazyLog ordena na hora da leitura."** A ordenação roda em segundo plano, para que em geral já esteja pronta quando a leitura chega. Uma leitura só espera se ultrapassar o `stable-gp`.
- **"O LazyLog enfraquece o shared log."** Os leitores têm a mesma ordem total linearizável. O que muda é que `append` não devolve mais uma posição.
- **"Consumidores do SpecLog agem sobre uma ordem especulativa."** Eles computam sobre ela. Tudo o que é visível de fora precisa esperar o `confirm_spec`, então a especulação esconde a ordenação em vez de removê-la.
- **"Fix-ante significa ordem antes da durabilidade."** Os shards preveem, e a camada de sequenciamento continua decidindo depois da durabilidade.
- **"O SpecLog é 1,6× mais rápido."** Esse número é do Belfast, com um tempo de computação perto do pico da curva.

## Resumo

Um shared log eager faz durabilidade, posição e consumo acontecerem juntos. O LazyLog separa confirmação de posição, apoiado no fato de que a ordem de tempo real já está implícita nas escritas em todas as réplicas, e usa o `stable-gp` para que nenhum leitor veja uma ordem que ainda possa mudar. Ele paga quando os leitores alcançam os escritores. O SpecLog separa consumo de confirmação: o fix-ante ordering torna as posições previsíveis, e o Belfast mantém as previsões certas sob picos e mudanças de membros. Ele paga com a espera por quotas, e seu ganho é limitado pelo momento em que a confirmação chega. Nos dois, o trabalho de ordenação continua acontecendo, e só o seu lugar na linha do tempo muda.

## Documentation Links

- [Luo et al.: LazyLog: A New Shared Log Abstraction for Low-Latency Applications (SOSP 2024)](https://dassl-uiuc.github.io/pdfs/papers/lazylog.pdf): a abstração, Erwin-■ e Erwin-st, o `stable-gp` e a avaliação contra Corfu e Scalog.
- [Bhat et al.: Low End-to-End Latency atop a Speculative Shared Log with Fix-Ante Ordering (OSDI 2025)](https://dassl-uiuc.github.io/pdfs/papers/speclog.pdf): a interface do SpecLog, o fix-ante ordering e o projeto e a avaliação do Belfast.
- [Ding et al.: Scalog: Seamless Reconfiguration and Total Order in a Scalable Shared Log (NSDI 2020)](https://www.usenix.org/system/files/nsdi20-paper-ding.pdf): o projeto durability-first ao qual os dois papers reagem.
