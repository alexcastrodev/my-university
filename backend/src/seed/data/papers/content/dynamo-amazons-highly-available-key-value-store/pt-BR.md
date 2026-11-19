---
title: "Dynamo: o armazenamento chave-valor altamente disponível da Amazon"
summary: DeCandia e colegas descrevem o Dynamo, o armazenamento chave-valor sempre gravável por trás do carrinho de compras da Amazon e de outros serviços centrais, que combina hashing consistente, relógios vetoriais, quóruns frouxos, hinted handoff, árvores de Merkle e gossip para manter a disponibilidade abrindo mão da consistência forte.
researchArea: Sistemas distribuídos
keywords: dynamo, armazenamento chave-valor, consistência eventual, hashing consistente, relógios vetoriais, quórum frouxo, gossip
version: 1.0
updatedAt: 2026-11-19
---

## Resumo

A confiabilidade em escala massiva é um dos maiores desafios que enfrentamos na Amazon.com, uma das maiores operações de comércio eletrônico do mundo; até a menor indisponibilidade tem consequências financeiras significativas e afeta a confiança dos clientes. A plataforma da Amazon.com, que fornece serviços para muitos sites no mundo todo, é implementada sobre uma infraestrutura de dezenas de milhares de servidores e componentes de rede localizados em muitos datacenters ao redor do mundo. Nessa escala, componentes pequenos e grandes falham continuamente, e a forma como o estado persistente é gerenciado diante dessas falhas determina a confiabilidade e a escalabilidade dos sistemas de software.

Este artigo apresenta o projeto e a implementação do Dynamo, um sistema de armazenamento chave-valor altamente disponível que alguns dos serviços centrais da Amazon usam para oferecer uma experiência "sempre ligada". Para alcançar esse nível de disponibilidade, o Dynamo sacrifica a consistência em certos cenários de falha. Ele faz uso extensivo de versionamento de objetos e de resolução de conflitos assistida pela aplicação, de um modo que oferece uma interface inovadora para os desenvolvedores.

## Visão geral

Em 2007 a Amazon operava uma plataforma de centenas de serviços em dezenas de milhares de servidores, e os autores argumentam que um banco relacional era uma má escolha para muitos deles: carrinhos de compras, estado de sessão, listas de mais vendidos e catálogos de produtos só precisam de acesso por chave primária, e a replicação dos bancos costuma escolher consistência em vez de disponibilidade. O Dynamo é a resposta: um armazenamento em que uma escrita quase nunca é recusada, mesmo com falhas de disco, partições de rede ou a perda de um datacenter.

O projeto fica deliberadamente do lado da disponibilidade no compromisso que a [conjectura de Brewer](/papers/brewers-conjecture-cap-feasibility-web-services) formalizou depois como CAP. Enquanto o [Paxos](/papers/paxos-made-simple), o [Raft](/papers/raft-understandable-consensus-algorithm) e sistemas como o [Spanner](/papers/spanner-globally-distributed-database) e o [FoundationDB](/papers/foundationdb-unbundled-transactional-kv-store) mantêm uma única ordem acordada de atualizações e pagam por isso com indisponibilidade do lado minoritário de uma partição, o Dynamo deixa as réplicas divergirem e as repara depois. Seus relógios vetoriais descendem dos relógios lógicos de [Tempo, relógios e a ordenação de eventos](/papers/lamport-time-clocks-ordering-of-events). O artigo é um relato de produção: os autores dizem que sua principal contribuição é avaliar como técnicas bem conhecidas podem ser combinadas num único sistema altamente disponível, e que um armazenamento eventualmente consistente pode rodar aplicações exigentes em produção.

Vale conhecer antes: anéis de hash (hashing consistente), quóruns e o significado de "consistência eventual", e por que atualizações concorrentes precisam de um meio de detectar que nenhuma veio antes da outra.

## Contribuição

- **Um ponto de projeto "sempre gravável".** A resolução de conflitos é empurrada para as leituras, de modo que escritas nunca são rejeitadas. O artigo aponta duas opções para quem resolve o conflito: o armazenamento (políticas simples como "a última escrita vence") ou a aplicação (por exemplo, mesclar carrinhos de compras).
- **Particionamento com nós virtuais.** As chaves passam por MD5 de 128 bits e são colocadas num anel. Cada nó físico detém várias posições ("tokens"), o que espalha a carga quando um nó sai ou entra e deixa máquinas mais fortes assumirem mais.
- **Replicação com lista de preferência.** Cada chave é guardada em N nós, o coordenador e seus N-1 sucessores no sentido horário, pulando posições para que a lista tenha nós físicos distintos e, na prática, vários datacenters.
- **Versionamento com relógios vetoriais.** Cada escrita cria uma nova versão imutável marcada com uma lista de pares (nó, contador). O sistema descarta as versões das quais uma mais nova descende e entrega ao cliente todas as outras para reconciliação semântica.
- **Quóruns ajustáveis (N, R, W).** Uma leitura espera R respostas e uma escrita espera W, então cada serviço escolhe seu ponto entre latência, durabilidade, consistência e disponibilidade.
- **Quórum frouxo e hinted handoff** para falhas temporárias, **anti-entropia com árvores de Merkle** para falhas permanentes e **gossip** para membros e detecção de falhas, sem coordenador central.

## Metodologia

A primeira metade é uma descrição de projeto: a interface do sistema (get(key) devolve um objeto ou uma lista de versões conflitantes mais um contexto opaco, put(key, context, object) o grava), o anel, a regra de replicação, o exemplo de relógio vetorial com as versões D1 a D5 e como leituras e escritas são executadas, incluindo o read repair. A seção 4 também explica como um nó indisponível é substituído pelo próximo nó saudável da lista de preferência, que guarda uma dica e devolve a réplica depois, e como dois nós encontram chaves divergentes comparando as raízes das árvores de Merkle e descendo pelos ramos que diferem.

A segunda metade relata a experiência de operar o Dynamo em produção. A implementação é em Java, com um motor de armazenamento local plugável (Berkeley DB Transactional Data Store, BDB Java Edition, MySQL ou um buffer em memória com armazenamento persistente de apoio). As medições vêm de sistemas reais com configuração (3,2,2) em algumas centenas de nós, e alguns números absolutos são omitidos por serem sensíveis ao negócio. O artigo compara três estratégias de particionamento num sistema com 30 nós e N=3, e compara a coordenação no servidor com a coordenação no cliente.

## Resultados

- **Latência.** Um SLA típico é 99,9% das leituras e escritas em até 300 ms. As latências no percentil 99,9 ficam em torno de 200 ms e cerca de uma ordem de grandeza acima das médias, e as escritas são mais lentas que as leituras porque sempre chegam ao disco.
- **Buffer de escrita.** Um buffer de objetos em memória reduziu a latência do percentil 99,9 por um fator de 5 no pico, mesmo com um buffer de mil objetos, ao custo de durabilidade. Para reduzir esse risco, o coordenador escolhe uma das N réplicas para fazer uma escrita durável, esperando ainda apenas W respostas.
- **Versões divergentes são raras.** No carrinho de compras, em 24 horas, 99,94% das requisições viram exatamente uma versão, 0,00057% viram duas, 0,00047% viram três e 0,00009% viram quatro. Os autores atribuem o aumento da divergência principalmente a escritores concorrentes, em geral clientes automatizados, e não a falhas.
- **Particionamento.** A estratégia 3 (Q/S tokens por nó, partições de tamanho igual) teve a melhor eficiência de balanceamento e reduziu em três ordens de grandeza os metadados de membros guardados em cada nó em relação à estratégia 1 (T tokens aleatórios por nó), além de simplificar o bootstrap e o arquivamento. A razão de desbalanceamento chegou a 20% com carga baixa e ficou perto de 10% com carga alta.
- **A coordenação no cliente** reduziu a latência de leitura e de escrita no percentil 99,9 de 68,9 e 68,5 ms para 30,4 ms, e as médias de 3,9 e 4,02 ms para 1,55 e 1,9 ms, ao eliminar o balanceador de carga e um salto extra. Os clientes atualizam a lista de membros a cada 10 segundos.
- **Disponibilidade.** Em cerca de dois anos de uso por serviços internos, as aplicações receberam respostas bem-sucedidas em 99,9995% das requisições e nenhum evento de perda de dados havia ocorrido. Na temporada de festas, o serviço do carrinho atendeu dezenas de milhões de requisições e mais de 3 milhões de checkouts em um dia.

## Análise crítica

O artigo é honesto sobre seus compromissos, e sua influência na geração NoSQL foi grande, mas as evidências têm limites.

- **A carga é estreita e os dados são parciais.** A avaliação vem dos sistemas de produção da própria Amazon, com taxas absolutas de requisições e durações de falhas omitidas, então não é reproduzível, e não há comparação com outro armazenamento.
- **Transferir conflitos para os desenvolvedores tem custo real.** O próprio artigo nota que itens apagados podem reaparecer num carrinho mesclado, e que aplicações novas precisam de análise inicial para escolher o método de reconciliação. Muitas equipes descobriram depois que "a última escrita vence" com timestamps físicos perde atualizações em silêncio.
- **O truncamento dos relógios vetoriais não é examinado.** O esquema descarta o par mais antigo depois de cerca de 10 entradas, o que pode tornar inexatas as relações de descendência, mas os autores só relatam que o problema "não apareceu em produção".
- **Limites de escala e de confiança.** Todo nó faz gossip da tabela de roteamento completa, o que os autores dizem funcionar para algumas centenas de nós e não para dezenas de milhares, e o sistema assume um ambiente não hostil, sem autenticação.
- **R + W > N não dá consistência forte.** Com quóruns frouxos, hinted handoff e sem uma ordem única de escritas, o quórum apenas torna leituras desatualizadas menos prováveis, um ponto fácil de perder ao comparar com o comportamento linearizável definido em [Linearizabilidade](/papers/linearizability-correctness-condition-concurrent-objects).

Livro versus hoje: o serviço gerenciado posterior da Amazon (DynamoDB) tem um projeto diferente e oferece opções mais fortes, então o artigo de 2007 descreve o ancestral e não o produto atual, enquanto Cassandra e Riak aproveitaram mais diretamente as ideias de anel, quórum e gossip.

## Pesquisas futuras

- Tipos de dados replicados livres de conflito (CRDTs) e outras estruturas fáceis de mesclar, que dispensam a reconciliação escrita à mão.
- Garantias mais fortes sobre o mesmo anel, como consistência causal e transações, sem abrir mão da disponibilidade.
- Projetos hierárquicos ou de membros parciais que levem o gossip e o roteamento além de algumas centenas de nós.
- Melhor detecção de falhas e agendamento de reparos, incluindo controle de admissão entre tarefas de fundo e de primeiro plano.
- Verificação formal e baseada em testes de armazenamentos eventualmente consistentes, incluindo injeção de falhas no estilo Jepsen.
