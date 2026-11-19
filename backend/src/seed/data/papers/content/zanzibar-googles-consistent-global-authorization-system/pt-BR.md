---
title: "Zanzibar: o sistema global e consistente de autorização do Google"
summary: O Zanzibar guarda listas de controle de acesso como tuplas de relação no Spanner e responde às verificações de autorização dos serviços do Google com consistência externa, usando um token de consistência mantido pelo cliente (o zookie) para que a maioria das verificações use dados já replicados localmente.
researchArea: Sistemas distribuídos
keywords: autorização, listas de controle de acesso, tuplas de relação, consistência externa, zookie, problema do novo inimigo, Spanner
version: 1.0
updatedAt: 2026-11-19
---

## Resumo

Determinar se usuários online estão autorizados a acessar objetos digitais é central para preservar a privacidade. Este artigo apresenta o projeto, a implementação e a implantação do Zanzibar, um sistema global para armazenar e avaliar listas de controle de acesso (ACLs). O Zanzibar oferece um modelo de dados e uma linguagem de configuração uniformes para expressar uma ampla gama de políticas de controle de acesso de centenas de serviços clientes do Google, entre eles Calendar, Cloud, Drive, Maps, Photos e YouTube. Suas decisões de autorização respeitam a ordem causal das ações dos usuários e, assim, oferecem consistência externa diante de mudanças nas ACLs e no conteúdo dos objetos. O Zanzibar escala para trilhões de ACLs e milhões de requisições de autorização por segundo, para atender serviços usados por bilhões de pessoas. Ele manteve latência no percentil 95 inferior a 10 milissegundos e disponibilidade superior a 99,999% ao longo de 3 anos de uso em produção.

## Visão geral

Todo serviço que compartilha objetos precisa responder "o usuário U pode fazer R no objeto O?" antes de responder ao usuário. Este artigo do ATC 2019, de autores do Google (dois deles depois em Humu e Carbon, com o trabalho feito enquanto estavam no Google), defende responder isso uma única vez, em um sistema compartilhado, em vez de em cada aplicação. São quatro motivos: semântica consistente, interoperabilidade quando uma aplicação embute objetos de outra, infraestrutura comum como um índice de busca que respeita o controle de acesso, e o fato de que consistência e escala são difíceis demais para resolver mais de uma vez.

O difícil não é a consulta, e sim a ordem. Se um usuário é removido de uma pasta e depois novos documentos são adicionados, uma verificação que enxerga uma cópia antiga da ACL pode expô-los a ele. Por isso o Zanzibar se apoia no [Spanner](/papers/spanner-globally-distributed-database) e na consistência externa baseada em TrueTime, que produz timestamps de commit [linearizáveis](/papers/linearizability-correctness-condition-concurrent-objects). A seção de trabalhos relacionados explica por que não usa [relógios de Lamport](/papers/lamport-time-clocks-ordering-of-events): eles exigem a participação de todos os "processos", e aqui alguns são clientes externos ou até pessoas. Ela também compara com o [Chubby](/papers/chubby-lock-service-loosely-coupled-distributed-systems) e o [ZooKeeper](/papers/zookeeper-wait-free-coordination-internet-scale-systems), e com o TAO, o armazém do grafo social do Facebook.

Vale saber antes: o que é uma ACL, o que significa uma leitura de snapshot em um timestamp num banco multiversão, e por que a latência de cauda importa quando uma página de resultados de busca exige dezenas a centenas de verificações.

## Contribuição

Os autores dizem que a maior parte do projeto tem raízes em pesquisas anteriores; a contribuição é o registro das técnicas combinadas para atender cinco metas (correção, flexibilidade, baixa latência, alta disponibilidade, grande escala).

- **Modelo de dados.** As ACLs são tuplas de relação na forma textual `objeto#relação@usuário`, em que o objeto é `namespace:id do objeto` e o usuário é um id de usuário ou um conjunto de usuários (userset) `objeto#relação`. O userset permite que uma tupla aponte para outra ACL, então grupos são ACLs cuja relação significa "membro", e o aninhamento é natural. A chave primária é namespace, id do objeto, relação e usuário.
- **Configuração de namespace.** Cada namespace declara suas relações e parâmetros de armazenamento. Uma relação pode ter uma regra de reescrita de userset, uma árvore de expressão cujas folhas são `this`, `computed_userset` (por exemplo, viewer inclui editor) e `tuple_to_userset` (por exemplo, herdar os viewers da pasta pai), combinadas com união, interseção e exclusão.
- **API.** Read devolve apenas as tuplas armazenadas, sem aplicar as regras de reescrita. Write altera tuplas, com uma receita de controle de concorrência otimista baseada em uma tupla de "lock" visível ao cliente. Watch transmite as mudanças de tuplas em ordem de timestamp. Check avalia um userset contra um usuário, e Expand devolve o userset efetivo como uma árvore.
- **Protocolo de consistência.** Toda escrita de ACL recebe um timestamp do Spanner. Quando um conteúdo está prestes a mudar, uma verificação de mudança de conteúdo é avaliada no snapshot mais recente e devolve um zookie, um token opaco que codifica um timestamp. O cliente o guarda junto com o conteúdo e o envia nas verificações seguintes, que são avaliadas em um snapshot pelo menos tão recente quanto ele. Isso impede o problema do "novo inimigo" (dois exemplos: ignorar a ordem das atualizações de ACL e aplicar uma ACL antiga a conteúdo novo).
- **Técnicas de serving.** Staleness padrão escolhida a partir de leituras fora da zona medidas, quantização de timestamps em um ou dez segundos para que caches compartilhem resultados, cache distribuído com hashing consistente e tabela de locks contra cache stampede, hedging de requisições para Spanner e Leopard, isolamento por cliente, e o Leopard, um índice de conjuntos para grupos muito aninhados.

## Metodologia

É um artigo de experiência, não um experimento controlado. Os números vêm do tráfego de produção do Google. A latência é medida no servidor, com tráfego real, porque, segundo os autores, cache e deduplicação só são refletidos de modo realista assim. A disponibilidade é medida com probers que reexecutam requisições reais amostradas (3 por cluster), contando só RPCs "qualificados" (bem formados, com prazo acima do limite, cliente dentro da cota) respondidos em 5 segundos para Safe e 15 segundos para Recent, agregados em janelas de 90 dias. Os dados de carga, latência e cache cobrem uma amostra de 7 dias em dezembro de 2018. As requisições são divididas pela idade do zookie: Safe tem zookies com mais de 10 segundos (o armazenamento replica com heartbeats de 8 segundos), Recent tem os mais novos.

## Resultados

Estes são os números que o artigo reporta.

- **Escala.** Mais de 1.500 namespaces de centenas de aplicações clientes, com arquivos de configuração de dezenas a milhares de linhas (mediana perto de 500). Mais de 2 trilhões de tuplas em perto de 100 TB, mediana de 15.000 tuplas por namespace, replicadas em mais de 30 locais e servidas por mais de 10.000 servidores em algumas dezenas de clusters. As 5 réplicas votantes ficam no leste e no centro dos Estados Unidos, a até 25 ms umas das outras.
- **Carga.** Mais de 10 milhões de consultas de clientes por segundo. Picos na semana amostrada: Check cerca de 4,2M QPS, Read 8,2M, Expand 760K, Write 25K, de modo que leituras superam escritas em duas ordens de grandeza. Checks Safe são cerca de duas ordens de grandeza mais frequentes que os Recent.
- **Latência (Tabela 2, mediana / p95 / p99, ms).** Check Safe 3,0 / 9,46 / 15,0; Read Safe 2,18 / 3,71 / 8,03; Expand Safe 4,27 / 8,84 / 34,1. Check Recent 2,86 / 60,0 / 76,3; Read Recent 2,21 / 40,1 / 86,2; Expand Recent 5,79 / 45,6 / 121,0. Write 127 / 233 / 401. Para Check Safe na semana, o percentil 99,9 chega a cerca de 93 ms no pico.
- **Disponibilidade.** Acima de 99,999% em 3 anos: menos de 2 minutos de indisponibilidade global por trimestre e menos de 13 minutos com a taxa global de erros acima de 10%.
- **Hot spots.** O artigo os chama de a fronteira mais crítica para latência e disponibilidade. No pico há 22 milhões de RPCs internos delegados por segundo e cerca de 200 milhões de consultas ao cache por segundo (150M de checks, 50M de reads). As taxas de acerto em checks parecem baixas (10% mais 12% pela tabela de locks no lado de quem recebe, 2% mais 3% no de quem delega), mas evitam que 500K RPCs internos por segundo criem hot spots. O Spanner recebe 20 milhões de RPCs de leitura por segundo, e 1% das leituras ao Spanner (200K por segundo) se beneficia do hedging.
- **Leopard.** 1,56M QPS na mediana e 2,22M no percentil 99, respondendo em menos de 150 microssegundos na mediana e menos de 1 ms no p99. Sua camada incremental absorve cerca de 500 atualizações por segundo na mediana e 1,5K no p99.

## Análise crítica

O que o próprio artigo afirma: o projeto é em boa parte uma combinação de ideias conhecidas, o hedging deliberadamente não é usado entre servidores do Zanzibar (duplicaria as verificações mais caras), e o Leopard só desnormaliza em namespaces selecionados, já que o sistema mantém dados normalizados por consistência.

O que o artigo não diz nem mede, como leitura das evidências:

- **Benefício do protocolo não quantificado.** Não há contagem de quantas vezes o "novo inimigo" ocorreria sem zookies, nem sistema de comparação ou ablação (nenhuma execução sem caches, hedging, Leopard ou quantização). O leitor recebe estatísticas de operação, não evidência causal de cada mecanismo.
- **A disciplina do cliente faz parte da garantia.** A proteção só vale se cada cliente pedir a verificação de mudança de conteúdo, guardar o zookie de forma atômica com o conteúdo e devolvê-lo. O Zanzibar não consegue impor isso, e o artigo não diz quantos clientes erram.
- **Requisições Recent são caras.** O p95 delas fica entre 40 e 60 ms, contra menos de 10 ms em Safe, e escritas levam 127 ms na mediana. O projeto compensa porque a maior parte do tráfego é Safe, uma propriedade da carga.
- **Difícil de reproduzir.** Depende do Spanner interno do Google (os autores observam que não é o Cloud Spanner), do TrueTime, do Slicer e de operação em escala Google. A disponibilidade também é medida reexecutando requisições amostradas e excluindo RPCs não qualificados, uma definição defensável, mas que não é a disponibilidade vista pelo usuário final.
- **Escopo.** O artigo nunca menciona ABAC nem ReBAC. Ele cita RBAC e diz que vários clientes implementam políticas RBAC sobre a configuração de namespaces, e não descreve linguagem de atributos ou condições. A autenticação fica de fora: o usuário de um check é "frequentemente representado por um token de autenticação". Também não descreve nenhuma liberação de código.

## Pesquisas futuras

- Neste app, a lição [Authorization Models: RBAC, ABAC, ReBAC and Policy Engines](/identity-concepts/authorization-models-rbac-abac-rebac-and-policy-engines) situa a autorização baseada em relacionamentos entre os demais modelos. O Zanzibar é o projeto de referência dessa família.
- Literatura posterior, que não faz parte do artigo. Sistemas de código aberto dizem seguir o projeto: o [SpiceDB](https://authzed.com/docs/spicedb/concepts/zanzibar) afirma ser "baseado no Google Zanzibar", o [README do OpenFGA](https://github.com/openfga/openfga) diz ser "inspirado no Google Zanzibar", e a [documentação do Ory Keto](https://www.ory.sh/docs/keto) o chama de a primeira implementação de código aberto de seus princípios de projeto. São afirmações dos próprios projetos, e o artigo não diz nada sobre eles; verifique o comportamento de consistência e de cache de cada um antes de supor que as garantias do zookie valem.
- Quais partes dependem do Spanner? Uma questão em aberto é quanto da proteção contra o "novo inimigo" sobrevive em bancos sem consistência externa no estilo TrueTime.
- Como combinar condições em tuplas (atributos, expiração) com o modelo de tuplas sem quebrar o cache consistente por snapshot, já que o artigo não tem esse recurso?
