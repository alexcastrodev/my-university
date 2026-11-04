---
title: "Scalog: reconfiguração sem interrupção e ordem total em um log compartilhado escalável"
summary: O Scalog é um log compartilhado com ordem total que primeiro replica os registros e só depois os ordena, intercalando periodicamente os logs FIFO dos seus servidores de armazenamento, de modo que shards podem ser adicionados ou finalizados sem coordenação global.
researchArea: Sistemas distribuídos
keywords: log compartilhado, ordem total, reconfiguração, sharding, persistência primeiro, paxos, replicação
version: 1.0
updatedAt: 2026-11-03
---

## Visão geral

Um log compartilhado é uma sequência ordenada de registros em que muitos clientes podem acrescentar e ler. Este artigo do NSDI 2020, da Cornell University e do Alibaba Group, parte de uma lacuna: o [Corfu](/papers/corfu-shared-log-design-for-flash-clusters) dá ordem total, mas fica indisponível sempre que seu conjunto de servidores de armazenamento muda, e o Kafka escala com shards, mas ordena os registros apenas dentro de cada shard. Nas palavras dos autores, "no shared log provides both total order and seamless reconfiguration" (nenhum log compartilhado oferece ao mesmo tempo ordem total e reconfiguração sem interrupção).

O diagnóstico deles está na ordem de dois passos. No Corfu e no LogDevice, um registro primeiro recebe uma posição e depois é replicado, então um cliente que falha depois de reservar uma posição pode deixar um buraco, e no Corfu todos os clientes e servidores precisam ter o mesmo mapeamento de posições para shards. O Scalog inverte os passos: os registros são replicados primeiro e recebem uma posição depois.

Vale conhecer antes: a abstração de log compartilhado, a replicação primary-backup, o Paxos e a diferença entre falhas por crash, que não podem ser detectadas com precisão, e fail-stop, que supõe que podem.

## Contribuição

- **Persistência antes da ordem.** Um cliente envia um registro a um servidor de armazenamento de sua escolha sem saber a posição dele. O servidor o encaminha por canais FIFO aos outros servidores do shard.
- **Ordem por intercalação de cuts.** Cada servidor relata periodicamente um cut local, um vetor que conta os registros que ele guarda por segmento. A camada de ordenação calcula o mínimo entre os servidores de um shard para descobrir o que está durável e envia um cut global a todos os servidores. Uma função determinística então ordena os registros entre cuts consecutivos.
- **Uma camada de ordenação que não lida com registros.** Ela roda Paxos acima de uma árvore de agregadores com soft state, e sua carga depende do número de servidores e da frequência dos relatos, não do throughput de escrita.
- **Reconfiguração sem coordenação global.** Um novo shard entra ao se registrar na camada de ordenação. Um shard é finalizado de forma agendada, com um período de carência em cuts confirmados, ou imediatamente depois de uma falha.
- **Três políticas de falha.** Finalize & Add e Remove & Replace precisam de f + 1 servidores por shard e Mask precisa de 2f + 1, trocando entre recursos, localidade dos dados e tempo de recuperação.
- **Posicionamento controlado pela aplicação.** Uma política de sharding permite que o vScalog use um shard como o materialized stream do [vCorfu](/papers/vcorfu-cloud-scale-object-store-on-a-shared-log), sem réplicas de stream separadas.

## Metodologia

O protótipo em Go rodou em 40 servidores do CloudLab com SSDs e rede de 10 Gbps, usando registros de 4 KB e, por padrão, f = 1: três réplicas Paxos e dois servidores por shard. A base de comparação é uma implementação do Corfu em Go feita pelos próprios autores, que eles relatam como mais rápida que a de código aberto.

Os testes de reconfiguração e de falhas usam seis shards a 50K escritas por segundo, cerca de metade do máximo. Para a escalabilidade de escrita, o intervalo de intercalação é fixado em 0,1 ms para igualar a latência de escrita do Corfu. Além de 40 máquinas, os autores emulam: primeiro os servidores de armazenamento, que relatam como se recebessem registros, e depois também camadas de agregadores, com o Paxos e a camada superior de agregadores em servidores físicos.

## Resultados

Estes são os resultados relatados pelos autores. Cada número de throughput vem de uma configuração diferente.

- **Reconfiguração.** Adicionar ou finalizar um shard não afeta o throughput do Scalog, enquanto o do Corfu para por cerca de 30 ms.
- **Falhas.** Depois da falha de um líder Paxos ou de um agregador, os registros não podem ser confirmados por um tempo, mas os servidores continuam a recebê-los, então o throughput cai e depois dá um salto, com o throughput total inalterado e a latência pior. Com Finalize & Add, o throughput volta depois de pouco mais de um segundo, com um timeout de um segundo.
- **Um shard.** O Scalog chega ao pico de 18,7K escritas por segundo e a base Corfu a 13,9K, diferença que os autores atribuem a escritas sequenciais contra aleatórias em disco.
- **Escala, medida.** 17 shards a 15K escritas por segundo cada um dão 255K escritas totalmente ordenadas por segundo.
- **Escala, emulada.** Com servidores de armazenamento emulados e agregadores reais, o Scalog alcança 2,34M escritas por segundo, ainda sem saturar. Com agregadores também emulados, a camada de ordenação suporta até 3.500 shards antes de o Paxos virar gargalo, o que se traduz em 52M. Os autores estimam essa latência em cerca de 1,6 ms. O Corfu fica limitado pelo sequenciador em 530K.
- **Leituras.** Um único servidor de armazenamento entrega 280K registros por segundo da memória. Do disco, o `subscribe` sequencial alcança 57K e o `readRecord` aleatório 4,5K.

## Análise crítica

O argumento de projeto é limpo, e o experimento de reconfiguração o mostra diretamente. Os números de escala pedem mais cuidado.

O próprio artigo declara vários limites. O Scalog não tem política automática para adicionar ou finalizar shards, não é adequado a latência ultrabaixa, altamente previsível ou com cauda baixa, e não trata de segurança. O vScalog precisa registrar toda transação, inclusive as que abortam. A nota de rodapé 4 diz que a emulação mede apenas quantos shards a camada de ordenação suporta, e que outras questões, como a rede, não foram avaliadas.

O restante é uma leitura das evidências, não uma afirmação dos autores.

- **52M mede a camada de ordenação, não um log em funcionamento.** O número equivale a cerca de 3.500 shards vezes os 15K configurados por shard, esses shards não guardam registros reais e a latência é uma estimativa. O maior resultado no texto com servidores de armazenamento reais é 255K, abaixo do limite de 530K do sequenciador do Corfu, então "almost two orders of magnitude" (quase duas ordens de grandeza) compara limites de capacidade, não logs implantados.
- **O consumo da ordem não é examinado.** Um cliente que lê de muitos servidores fica limitado pela rede a uma média de 280K registros por segundo aqui. Um assinante que queira o log inteiro não conseguiria acompanhar 2,34M registros por segundo por esse enlace, muito menos 52M.
- **A reconfiguração sem interrupção é mais restrita sob falha.** O resultado limpo cobre mudanças planejadas a meia carga. Depois de uma falha de armazenamento, o custo depende da política. Com Finalize & Add, os clientes precisam se redirecionar e retransmitir os registros que faltam no último cut, e um único servidor intoleravelmente lento finaliza o shard inteiro. Remove & Replace interrompe temporariamente as escritas no shard. Mask mantém o shard servindo leituras e escritas, mas exige 2f + 1 servidores. O custo de falsas suspeitas não é medido.
- **Algumas afirmações têm pouco respaldo.** O dobro de throughput de leitura do vScalog aparece na introdução, mas a avaliação dele relata apenas escritas. As leituras do Corfu são chamadas de idênticas por raciocínio sobre os caminhos, não por medição. A base de comparação é uma reimplementação sobre SSDs, e o texto não relata percentis de latência.

## Pesquisas futuras

- Se é possível reduzir drasticamente a latência mantendo o throughput e a ordenação do Scalog, uma pergunta que o próprio artigo deixa em aberto.
- Políticas automáticas para adicionar e finalizar shards que também limitem finalizações causadas por falsas suspeitas.
- Um teste de ponta a ponta com milhares de shards reais, incluindo a rede e a distribuição dos cuts.
- Como assinantes podem consumir uma ordem total maior que a banda de qualquer cliente individual, e quais aplicações precisam dela inteira.
- Uma especificação verificada por máquina da ordenação por cuts junto com a reconfiguração, que o artigo não traz.
