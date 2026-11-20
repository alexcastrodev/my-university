---
title: "Orleans: atores virtuais distribuídos para programabilidade e escalabilidade"
summary: O relatório de 2014 da Microsoft Research introduz os atores virtuais, entidades que existem sempre de forma lógica e que o runtime ativa sob demanda em qualquer servidor, de modo que colocação, ciclo de vida e recuperação de falhas deixam de ser tarefa da aplicação. A avaliação usa o código do Halo 4 Presence em até 125 servidores.
researchArea: Sistemas distribuídos
keywords: atores virtuais, modelo de atores, transparência de localização, diretório distribuído, ativação única eventual, promessas, Halo 4
version: 1.0
updatedAt: 2026-11-20
---

## Resumo

Serviços interativos de grande escala exigem alta vazão, baixa latência e alta disponibilidade, metas difíceis de atingir com a arquitetura tradicional de três camadas sem estado. O modelo de atores torna natural construir uma camada intermediária com estado e obter o desempenho necessário. No entanto, as plataformas populares de atores ainda passam muitos problemas de sistemas distribuídos para os desenvolvedores. O modelo de programação do Orleans introduz a abstração inédita de atores virtuais, que resolve vários desses problemas complexos, como confiabilidade e gerenciamento distribuído de recursos, liberando os desenvolvedores dessas preocupações. Ao mesmo tempo, o runtime do Orleans permite que as aplicações alcancem alto desempenho, confiabilidade e escalabilidade. Este artigo apresenta os princípios de projeto do Orleans e demonstra como ele chega a um modelo de programação simples que atende a essas metas. Descrevemos como o Orleans simplificou o desenvolvimento de vários aplicativos de produção escaláveis no Windows Azure e relatamos o desempenho desses sistemas de produção.

## Visão geral

Este é o relatório técnico MSR-TR-2014-41 da Microsoft Research (março de 2014), de Bernstein, Bykov, Geller, Kliot e Thelin. É um relatório técnico, não um artigo revisado por pares. O problema: uma camada intermediária sem estado obriga toda requisição a passar pelo armazenamento, e um cache na frente dele perde as garantias de concorrência, como em [Scaling Memcache no Facebook](/papers/scaling-memcache-at-facebook). Atores mantêm o estado junto do código. Mas Erlang e Akka ainda deixam ao desenvolvedor o ciclo de vida dos atores e as corridas distribuídas, o tratamento de falhas e a recuperação, e a colocação, o que, segundo os autores, exige um especialista em sistemas distribuídos.

O relatório é o segundo artigo do Orleans. O primeiro é [Orleans: Cloud Computing for Everyone](/papers/orleans-cloud-computing-for-everyone) (SoCC 2011). Usando só o que os dois textos dizem, três coisas mudaram. O relatório de 2014 diz que o protótipo exigia gerenciar o ciclo de vida explicitamente, e agora atores não podem ser criados nem destruídos de forma explícita. Diz que a replicação multi-master de atores com várias ativações foi abandonada porque tinha mau desempenho e os usuários a achavam complexa demais, e as transações de 2011 não aparecem no modelo: "Orleans does not yet support cross-actor transactions". Diz também que o protótipo persistia o estado a cada chamada, caro demais, então a persistência virou checkpoints explícitos, e a sintaxe explícita de promessas deu lugar ao async-await. A avaliação de 2011 usava microbenchmarks; esta usa código de produção. O diretório DHT de um salto com caches aparece nos dois textos.

## Contribuição

- **Ator virtual.** Um ator tem existência perpétua, instanciação automática, transparência de localização e escala automática. A identidade é o tipo do ator mais uma chave primária (um GUID de 128 bits). Os autores comparam com a memória virtual: uma camada de indireção que deixa o runtime colocar, mover e recuperar instâncias físicas.
- **Ativações e turnos.** As instâncias em memória se chamam ativações. Uma ativação executa um turno por vez, sendo um turno uma chamada de método ou um closure executado quando uma promessa é resolvida. Por padrão uma requisição não é intercalada com outra na mesma ativação, e o atributo `[Reentrant]` permite intercalar turnos, ainda com um só thread.
- **Promessas.** Todo método de ator devolve uma promessa (`Task` ou `Task<T>`) que está não resolvida, cumprida ou quebrada. As referências são criadas localmente e dispensam passo de bind ou registro.
- **Dois modos de ativação.** Ativação única (padrão) e worker sem estado, com várias ativações independentes criadas até um limite, sem reconciliação de estado.
- **Serviços do runtime.** Diretório, associação de servidores, lembretes (timers que disparam mesmo com o ator inativo), provedores de persistência e mensagens com entrega ao menos uma vez.

## Metodologia

A Seção 3 descreve o runtime num cluster de servidores. Cada servidor hospeda ativações e tem os subsistemas de Mensagens, Hospedagem e Execução. A Hospedagem mantém um diretório distribuído: uma DHT de um salto com hash consistente, um registro por id de ator e um cache local de cerca de 80 bytes por entrada de ator de ativação única. A colocação é "completamente flexível", não determinada por hash: no Presence, as ativações do Router sem estado ficam no servidor que recebeu a requisição e os outros tipos de ator se espalham aleatoriamente pelos servidores. Atores ociosos, ou pressão de memória, disparam a desativação. O escalonamento é cooperativo, com cerca de um thread por núcleo.

A avaliação (Seção 5) rodou em até 125 servidores com dois Opterons quad-core de 2,10 GHz, 32 GB de RAM, Windows Server 2008 R2 e .NET 4.5. Os microbenchmarks rodaram 5 vezes por 10 minutos. O código de produção do Halo 4 Presence rodou num cluster de teste por 30 minutos por execução, com carga de heartbeats gerada. Os números de produção são confidenciais, então o relatório traz números de laboratório. A Seção 4 descreve Presence, Statistics, Galactic Reign e um pool de conexões de banco feito com atores Shard.

## Resultados

- **Isolamento.** A cópia profunda dos argumentos custa 4,3% para um array de 100 bytes (7300 contra 7000 requisições por segundo), 9,5% para um dicionário de 100 elementos e 47,7% para um dicionário de listas (6500 contra 3400), com 50% de chamadas remotas.
- **Mascaramento de latência.** A vazão por servidor fica quase constante enquanto a latência simulada de chamadas externas vai de 10 a 1000 ms (Figura 4, leitura de gráfico: cerca de 8000 por servidor). Mais threads no escalonador reduzem a vazão (Figura 5, leitura de gráfico: de cerca de 11.000 com 8 threads a cerca de 4.300 com 1000).
- **Escala do Presence.** Com 1 milhão de atores e CPU em 95 a 97%, 25 servidores sustentam cerca de 130.000 heartbeats por segundo (cerca de 5200 por servidor), e a vazão é quase linear até 125 servidores (Figura 6, leitura de gráfico: cerca de 600.000). Com 25 servidores, a vazão é quase a mesma de 2 mil a 2 milhões de atores (texto); a pequena queda no extremo alto é atribuída ao tamanho maior das estruturas internas.
- **Latência sob carga.** A latência mediana do heartbeat é de cerca de 6,5 ms até 19% de CPU, 10 ms a 34% e 15 ms a 55%. A Figura 8 (leitura de gráfico) mostra o percentil 95 perto de 650 ms a 72% de CPU.
- **Afirmações de produção.** Taxas de acerto do cache "bem acima de 90%" nos serviços em produção, e testes de carga com 25 servidores a mais de 90% de CPU por muitos dias. Os autores dizem que o ganho de produtividade foi verificado "pelo menos de forma anedótica".

## Análise crítica

O que o relatório não afirma. Ele não dá consistência forte entre atores: não há transações entre atores, e a persistência fica a cargo do desenvolvedor. A unicidade é eventual: "In failure-free times, Orleans guarantees that an actor only has a single activation", mas depois de uma falha duas ativações podem se registrar em partições diferentes do diretório até a associação de servidores se estabilizar, e então uma é desativada. Os autores escolheram disponibilidade em vez de consistência e apontam o armazenamento externo para exigências mais fortes, o que lembra o trade-off do [Dynamo](/papers/dynamo-amazons-highly-available-key-value-store) e a discussão do [CAP](/papers/brewers-conjecture-cap-feasibility-web-services). A entrega é ao menos uma vez, a ordem FIFO foi abandonada pelo custo de estado (n^2 números de sequência e filas), e exatamente uma vez aparece como trabalho futuro.

Limites da evidência. É o projeto e a experiência de um único fornecedor, sem revisão por pares. O serviço medido é o Presence, que guarda estado só em memória porque os consoles têm a verdade. Faltam experimentos de falha: a associação converge em 30 a 60 segundos em produção, mas nenhum experimento mede a recuperação. O próprio relatório lista usos ruins: operações em massa sobre muitas entidades, bilhões de atores sem localidade temporal e uso multi-inquilino.

Notas de leitura, não afirmações do relatório. O diretório cita o [Chord](/papers/chord-scalable-peer-to-peer-lookup-service), mas o relatório não discute outros projetos de associação de servidores, como o [SWIM](/papers/swim-scalable-weakly-consistent-infection-style-process-group-membership-protocol). Abandonar a reconciliação é um caminho diferente dos [CRDTs](/papers/conflict-free-replicated-data-types).

Trabalho posterior (fora do relatório, não lido por mim). Não li o trabalho de transações do Orleans, o Akka Cluster Sharding, os Durable Objects da Cloudflare nem as Azure Durable Functions, então não faço afirmações sobre eles.

## Pesquisas futuras

- Testar a ativação única eventual durante uma partição de rede: quanto tempo duplicatas vivem e o que corrompem quando o estado é persistido?
- Comparar com [Consenso no commit de transações](/papers/consensus-on-transaction-commit), o tipo de protocolo de que as transações entre atores adiadas pelo relatório precisariam.
- Medir a recuperação de falhas, incluindo a janela de 30 a 60 segundos da associação e a perda do diretório, que a avaliação deixa de fora.
- Verificar quais resultados do Presence sobrevivem com estado persistente e checkpoints rigorosos.
