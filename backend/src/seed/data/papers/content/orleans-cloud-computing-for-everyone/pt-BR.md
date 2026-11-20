---
title: "Orleans: computação em nuvem para todos"
summary: O Orleans é um framework .NET que dá às aplicações de nuvem atores isolados e de um só thread chamados grains, replicados sob demanda em ativações, com promises para a assincronia e transações leves otimistas mais reconciliação por branch-and-merge para a consistência. Este é o projeto de 2011, anterior ao modelo de atores virtuais do relatório de 2014.
researchArea: Sistemas distribuídos
keywords: modelo de atores, grains, ativações, promises, transações leves, branch-and-merge, programação para nuvem
version: 1.0
updatedAt: 2026-11-20
---

## Resumo

A computação em nuvem é um novo paradigma de computação que combina dispositivos cliente diversos (PCs, smartphones, sensores, dispositivos de função única e embarcados) com computação e armazenamento de dados na nuvem. Como em todo avanço da computação, a programação é um desafio fundamental, pois a nuvem é um sistema concorrente e distribuído que roda sobre hardware e redes não confiáveis. O Orleans é um framework de software para construir aplicações de nuvem confiáveis, escaláveis e elásticas. Seu modelo de programação incentiva o uso de padrões simples de concorrência, fáceis de entender e de empregar corretamente. Ele se baseia em componentes distribuídos semelhantes a atores, chamados grains, que são unidades isoladas de estado e computação que se comunicam por mensagens assíncronas. Dentro de um grain, as promises são o mecanismo para gerenciar tanto as mensagens assíncronas quanto a concorrência local baseada em tarefas. O estado isolado e um modelo de execução restrito permitem ao Orleans persistir, migrar, replicar e reconciliar o estado dos grains. Além disso, o Orleans oferece transações leves que sustentam uma visão consistente do estado e servem de base para o tratamento automático de erros e a recuperação de falhas. Implementamos várias aplicações no Orleans, de uma aplicação de rede social intensiva em mensagens a um cálculo de álgebra linear intensivo em dados e computação. O modelo de programação é geral, pois o Orleans permite que as comunicações evoluam dinamicamente em tempo de execução. O Orleans permite ao desenvolvedor se concentrar na lógica da aplicação, enquanto o runtime fornece escalabilidade, disponibilidade e confiabilidade.

## Visão geral

Software de nuvem é concorrente e distribuído, roda em máquinas comuns que falham e precisa absorver cargas que variam de forma imprevisível. Sistemas como o [MapReduce](/papers/mapreduce-simplified-data-processing-large-clusters) servem ao processamento em lote offline, mas o artigo argumenta que não atendem requisições interativas que tocam um pequeno conjunto de itens relacionados. Este artigo do SoCC 2011, da Microsoft Research, propõe a aposta oposta: um modelo de atores deliberadamente restrito para .NET, que empurra o desenvolvedor para padrões escaláveis, enquanto o runtime assume a persistência, a replicação e a recuperação de erros.

Não leia este texto como o artigo dos "atores virtuais". Esse é o relatório técnico de 2014 de Bernstein e coautores, pelo qual o Orleans ficou conhecido depois. O projeto de 2011 é diferente em vários pontos, listados na Análise crítica. Conhecer o Orleans em .NET de hoje ajuda, mas não é necessário.

## Contribuição

- **Grains.** A unidade de ator. Grains não compartilham memória, são internamente de um só thread e executam cada requisição como um turno que termina antes de o próximo começar, então não há necessidade de locks dentro de um grain. As interfaces são interfaces .NET comuns cujos métodos retornam todos promises.
- **Promises.** Uma chamada retorna imediatamente com uma promise que pode estar não resolvida, cumprida ou quebrada. Os erros se propagam por promises encadeadas, como um try/catch assíncrono.
- **Ativações.** Um grain ocupado pode ter várias ativações rodando de forma independente, possivelmente em servidores diferentes. O artigo diz que isso estende o modelo clássico de atores e que nenhuma outra linguagem de atores suporta replicação de forma intrínseca.
- **Reconciliação.** As ativações de um mesmo grain criam ramos (revisões) do estado persistente e os mesclam de volta com um modelo de branch-and-merge, com registros, listas e dicionários reconciliáveis embutidos e espaço para políticas próprias.
- **Transações leves.** Cada requisição externa roda como uma transação sobre todos os grains que ela toca. Ela enxerga uma única ativação de cada grain, pode abortar e ser reexecutada em caso de falha, e é gravada no armazenamento de forma assíncrona (otimista) ou com espera (pessimista).

## Metodologia

O artigo descreve o modelo de programação e o runtime, e depois três aplicações. O Chirper é um serviço pub/sub parecido com o Twitter, escrito em 200 linhas de C# do Orleans. Uma biblioteca de álgebra linear, escrita por um colega, usa grains operários e coordenadores. Um motor de grafos coloca uma partição de nós (10^4 a 10^6) em cada grain. As medições rodaram em até 50 servidores, cada um com dois AMD Opteron de quatro núcleos a 2,10 GHz, 32 GB de RAM e Windows Server 2008 R2. Os testes foram micro benchmarks do custo de invocação e de promises, o throughput do Chirper numa rede sintética de 1.000 contas em que cada uma segue 27 usuários aleatórios, um teste de sobrecarga em um único grain e o PageRank sobre um grafo de 134 milhões de páginas.

## Resultados

Os números abaixo vêm do texto. As Figuras 5 a 9 são gráficos, e usei apenas valores declarados no texto.

- **Invocação.** A latência de ida e volta de uma chamada a um grain é de cerca de 1,2 ms remota e 0,5 ms local (a Figura 5 mostra média e percentil 95). Uma promise custa de 50 a 100 microssegundos. Criar um grain leva cerca de 5 ms, incluindo a primeira ativação e o registro no diretório.
- **Chirper.** O throughput escala linearmente com os servidores: cerca de 7.000 chirps por segundo com 35 servidores, contra uma média citada de cerca de 1.600 tweets por segundo no Twitter e um pico registrado de 6.939 em um segundo. Os servidores ficaram com 94 a 96 por cento de CPU, gastos sobretudo em serializar mensagens.
- **Grain quente.** Com 10 ms de processamento por mensagem, criar várias ativações de um grain numa única máquina mantém o throughput escalando de forma quase linear (Figura 7, sem número no texto). Desligar as transações, com uma ativação por grain, deu 13 por cento mais throughput com 10 ms de trabalho e 2 por cento com 100 ms, em comparação com transações ligadas e uma ativação. Os dois mecanismos não puderam ser medidos separadamente.
- **PageRank.** 10 iterações sobre 134 milhões de páginas e 1,4 bilhão de links. Numa máquina não escala bem, porque a E/S satura. Entre servidores é quase linear até 4 servidores e chega a um speedup de 13 com 32. Os autores dizem que o mesmo programa escalou de 16 para 512 núcleos sem mudanças. Rodou cerca de duas ordens de grandeza mais rápido que uma implementação em Dryad, o que os autores atribuem principalmente a manter os dados em memória entre iterações e ao balanceamento dinâmico de carga, ao custo de mais código.

## Análise crítica

O artigo não traz experiência de produção: "It is too early to report on our experience". A evidência é um benchmark social, uma computação limitada por E/S e um motor de grafos sem medições. Os próprios autores apontam dois limites: o armazenamento do sistema é um ponto único de falha e um gargalo, e particionar um grain muito grande (uma conta popular) fica a cargo do desenvolvedor.

Os pontos a seguir são uma leitura do artigo, não afirmações dele.

- **A história da consistência é a parte menos testada.** As transações são mais fracas que o snapshot isolation (permitem conflitos escrita-escrita), e o artigo não tem experimento de falha, taxa de aborts nem teste do caminho de commit. A persistência usa two-phase commit, protocolo que o artigo trata como dado (veja [Consenso no commit de transações](/papers/consensus-on-transaction-commit) para seus compromissos de bloqueio).
- **Sem história de associação de servidores nem de partições.** O texto nunca discute detecção de falhas, associação de servidores ou partições de rede, e não cita nenhum protocolo de consenso. O diretório é descrito apenas como uma tabela hash de um salto com cache adaptativo. O [Chord](/papers/chord-scalable-peer-to-peer-lookup-service) e o [Dynamo](/papers/dynamo-amazons-highly-available-key-value-store) são as referências usuais para esse problema, mas este artigo não os usa.
- **Reconciliação é outra aposta, diferente de tipos convergentes.** As mesclagens usam políticas definidas pela aplicação e podem ser rejeitadas e repetidas. Os [CRDTs](/papers/conflict-free-replicated-data-types) garantem convergência por construção. O artigo não os compara.

Literatura posterior (não faz parte deste artigo). Li em parte o relatório técnico de 2014 de Bernstein, Bykov, Geller, Kliot e Thelin (MSR-TR-2014-41), seções 2 e 3 e o começo da 4. Ele descreve um modelo em que os atores têm existência perpétua do ponto de vista lógico e são ativados sob demanda, a ativação única é o padrão e os stateless workers são o único modo com várias ativações, sem reconciliação de estado. Afirma que o Orleans "does not yet support cross-actor transactions". Acrescenta um mecanismo de associação de servidores com heartbeats e um diretório particionado por hash consistente, e diz que a ativação única só é garantida de forma eventual depois de falhas. Nas partes que li, as transações e o branch-and-merge de 2011 não aparecem, então parecem não ter sido o caminho que permaneceu. Não li os trabalhos posteriores sobre transações do Orleans, o Akka Cluster Sharding, os Durable Objects da Cloudflare nem os Azure Durable Functions, então não faço afirmações sobre eles.

## Pesquisas futuras

- Ler em seguida o relatório de 2014: atores virtuais, associação de servidores, diretório e a avaliação do serviço de Presence do Halo 4 estão lá, e ele é a ponte para o Orleans em .NET.
- Comparar o que 2011 prometia (grains replicados, requisições atômicas entre vários grains) com o que o relatório de 2014 manteve, e por que as transações entre grains só voltaram depois.
- Medir o comportamento sob falhas que o artigo omite: taxas de abort e de retentativa, latência de commit e recuperação após a perda de um servidor.
- Pesar tipos de dados convergentes como os [CRDTs](/papers/conflict-free-replicated-data-types) contra o branch-and-merge para o estado dos grains.
