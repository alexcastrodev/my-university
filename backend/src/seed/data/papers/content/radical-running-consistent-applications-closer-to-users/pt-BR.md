---
title: "Executando aplicações consistentes mais perto dos usuários com o Radical para menor latência"
summary: O Radical executa aplicações fortemente consistentes em locais próximos aos usuários, rodando-as de forma especulativa sobre um cache eventualmente consistente enquanto uma única requisição LVI ao datacenter primário trava, valida e registra write intents, e o resultado especulativo só é liberado quando é linearizável.
researchArea: Sistemas distribuídos
keywords: linearizabilidade, execução especulativa, serverless, cache próximo ao usuário, análise estática, reexecução determinística, webassembly
version: 1.0
updatedAt: 2026-11-07
---

## Visão geral

Redes sociais, sites de reserva e fóruns precisam de consistência forte, então costumam rodar em um datacenter primário ao lado do armazenamento. Novos datacenters, pontos de presença na borda e clusters on-premises poderiam aproximá-los dos usuários, mas os autores argumentam que isso não ajuda por si só. Um local sem réplica do armazenamento paga a distância em cada acesso. Com armazenamento georreplicado, cada acesso se coordena com réplicas distantes, e o resultado PRAM que eles citam limita inferiormente a soma das latências de leitura e escrita pela distância entre réplicas. No experimento dos próprios autores com as global tables do DynamoDB, a georreplicação foi, na maioria dos casos, pior do que uma implantação centralizada.

Este artigo do SOSP 2025 (Seul) é de Nicolaas Kaashoek, Amit Levy e Wyatt Lloyd (Princeton University), Oleg A. Golev (Sentient Foundation) e Austin T. Li (Cornell University), os dois últimos tendo feito o trabalho em Princeton. O Radical mantém a cópia primária dos dados em um local **próximo ao armazenamento** (near-storage) e acrescenta caches eventualmente consistentes em cada local **próximo ao usuário** (near-user). Uma função roda de forma especulativa sobre o cache local enquanto o protocolo **LVI** (LockValidate-WriteIntent) faz uma única requisição ao primário. Mais dois termos importam: o **conjunto de leitura e escrita** (read/write set), que a análise estática deriva antes de a função rodar, e a **write intent**, um registro que permite ao primário concluir uma escrita se o local próximo ao usuário desaparecer.

Vale conhecer antes: linearizabilidade, locks de leitura e escrita, funções serverless, o [Spanner](/papers/spanner-globally-distributed-database), o armazenamento georreplicado contra o qual o artigo se posiciona, e o [Calvin](/papers/calvin-fast-distributed-transactions-for-partitioned-databases), que também precisa do conjunto de leitura e escrita de uma transação com antecedência, mas pede que os usuários o forneçam.

## Contribuição

- **Arquitetura.** Cada local próximo ao usuário tem um runtime e uma biblioteca de armazenamento na frente de um cache que não precisa ser durável nem consistente. O local próximo ao armazenamento tem o armazenamento primário, linearizável e durável (o artigo cita DynamoDB, BigTable e CosmosDB), um servidor LVI, cópias de backup das funções, um número de versão guardado com cada item e uma tabela de write intents.
- **Uma requisição LVI, sobreposta à execução.** O runtime primeiro roda uma função derivada que devolve o conjunto de leitura e escrita, depois roda a função de verdade sobre o cache enquanto envia as versões do cache ao primário. Lá, o servidor pega um lock de leitura ou de escrita por item (ordenados lexicograficamente para evitar deadlock), compara as versões e, se elas batem e a função escreve, grava uma write intent e inicia um timer. O cliente recebe a resposta especulativa quando a função termina e a requisição volta.
- **Validação que falha.** A cópia de backup roda no primário sob os locks já mantidos, e a resposta traz o resultado mais valores e versões novos dos itens desatualizados. É assim também que os caches se enchem e se curam, então nunca precisam de durabilidade. Um cache miss é enviado com versão -1 e dispensa a especulação.
- **Escritas por um followup.** O local próximo ao usuário envia suas escritas depois de responder ao cliente. Se o followup nunca chega, o timer dispara e o primário reexecuta a função, o que é seguro porque os locks de leitura congelaram suas entradas. A intent é então marcada como tratada, e um followup atrasado é descartado.
- **Análise estática.** Execução simbólica e análise de dependências, construídas sobre o Eunomia, transformam cada função em uma função de conjunto de leitura e escrita no momento do registro. Leituras dependentes rodam dentro dessa função sobre o cache, já que uma primeira leitura desatualizada é pega pela validação. Se o analisador falha ou estoura o tempo, a função roda perto do armazenamento.
- **Requisitos para as aplicações.** Os handlers precisam ser funções serverless compiladas para um subconjunto determinístico de WebAssembly, sem timers nem aleatoriedade. Serviços externos precisam oferecer semântica at-most-once, como o Stripe faz com chaves de idempotência. Um handler também precisa rodar por tempo suficiente para esconder a requisição, o que os autores estimam em cerca de 20 ms.
- **Corretude.** O artigo argumenta a linearizabilidade para os três caminhos de execução (sucesso, validação que falha, followup atrasado). A prova formal está em um registro separado no Zenodo.

## Metodologia

O protótipo roda no AWS Lambda, com um servidor LVI no EC2 e o DynamoDB como armazenamento. Ele tem cerca de 1000 linhas de Rust no runtime, cerca de 2000 linhas de Go no servidor LVI (um singleton, com mais cerca de 500 linhas para uma variante replicada) e cerca de 2000 linhas adicionadas ou alteradas nas aproximadamente 8000 linhas de Python do Eunomia. As funções são escritas em Rust e rodam no WasmTime.

Os autores portaram Diaspora, Discourse, Danbooru, Lobsters e o benchmark de hotéis do DeathStarBench para 27 funções. Eles avaliam rede social, fórum e reserva de hotel (16 funções na Tabela 1). As implantações ficam em cinco locais da AWS: Virgínia (primário), Califórnia, Irlanda, Frankfurt e Tóquio, com round trips até a Virgínia de 7, 74, 70, 93 e 146 ms. Os clientes ficam nos mesmos locais (50 processos cliente em uma instância EC2). As cargas são enviesadas (Zipf 0,99) para rede social e fórum e uniformes para hotel. As latências são medianas de 10.000 requisições.

São usadas duas bases de comparação: todas as requisições enviadas à aplicação na Virgínia e um limite inferior inconsistente, em que cada região roda sobre a própria cópia local. O DynamoDB também serve de cache, para isolar o protocolo da velocidade do armazenamento. As global tables do DynamoDB não são executadas, porque o recurso não está disponível em todas as regiões, e os autores raciocinam a partir do experimento anterior. O servidor LVI replicado guarda seus locks em um cluster etcd de três nós, que roda o [Raft](/papers/raft-understandable-consensus-algorithm).

## Resultados

Estes são os resultados relatados pelos autores.

- **Ponta a ponta.** Em comparação com a base no datacenter primário, o Radical reduz a latência de 28% a 35% nas aplicações. Ele alcança 89% da melhor melhoria possível no hotel, 88% na rede social e 84% no fórum, com consistência forte e durabilidade.
- **A validação se sustenta sob enviesamento.** A taxa de sucesso fica em torno de 95% em todas as aplicações, então a segunda execução no primário é necessária em cerca de 5% das requisições.
- **A distância puxa o ganho.** Locais com round trips maiores se beneficiam mais, e a Virgínia fica um pouco pior que a base por causa do overhead do Radical. A rede social no Japão é a exceção: seu round trip excede o tempo de execução de 4 funções, então os resultados esperam pela requisição.
- **O tamanho da função importa.** Funções mais longas que o round trip ganham mais. As curtas (forum-interact, forum-post, hotel-review) terminam a poucos ms de rodar perto do armazenamento, então o Radical fica, no pior caso, parecido com isso.
- **Servidor replicado.** Um lock custa 2,3 ms e a chave de idempotência 3 ms, então uma requisição soma 3 + 2,3 × L ms para L locks, e o tempo mínimo de execução que compensa passa a ser 16 + 2,3 × L ms. Com batching, os autores consideram 20 ms razoável.
- **Custo.** Para uma carga assumida de 50.000 leituras e 500 escritas por segundo, o Radical custa US$ 1.413,36 por mês (DynamoDB, caches ScyllaDB e servidor LVI), 31% acima da base. Com 100 milhões de invocações por mês, a base custa US$ 1.364,36 e o Radical US$ 1.714,71.
- **Throughput.** Não foi medido. Os autores dizem que ele é igual ao da base porque o único gargalo acrescentado é o servidor singleton, que bastou.

## Análise crítica

A ideia é limpa: pagar um round trip, mas escondê-lo sob um trabalho que a função já estava fazendo de qualquer jeito. O artigo admite vários limites.

- **Nem toda aplicação se beneficia.** Alguns conjuntos de leitura e escrita não podem ser derivados a baixo custo, e então a função derivada roda em série com a de verdade. Nem toda aplicação é determinística, e algumas precisam de refatoração significativa.
- **Os locks limitam o paralelismo.** Quem escreve na mesma chave espera o followup de quem detém o lock, e os autores contam com locks de leitura e baixo enviesamento para atenuar isso.
- **Confiança e implantação.** Os dois locais precisam ser confiáveis e rodar o mesmo runtime serverless. O servidor LVI avaliado é um singleton, e ligar a função derivada ao código exige trabalho manual.

Os pontos a seguir são uma leitura das evidências, não afirmações do artigo.

- **Falhas não são exercitadas.** Se um local próximo ao usuário morre, seus locks ficam retidos até o timer disparar e o primário reexecutar. O artigo não dá o valor do timer, o tempo de retenção dos locks nem a latência vista por quem escreve e espera. O servidor replicado é medido apenas como custo por lock, não ponta a ponta.
- **A contenção é argumentada, não medida.** Os locks de escrita duram a execução mais a viagem do followup, então quem escreve de longe em uma chave quente fica na fila por esse tempo. Somando as participações da Tabela 1, as escritas ficam em cerca de 1% na rede social e no hotel e em 10% no fórum, e nenhum experimento varia a proporção de escritas, o enviesamento ou o número de clientes.
- **A avaliação é regional.** A motivação lista pontos de presença na borda e clusters on-premises, mas os cinco locais são regiões da AWS, com clientes ao lado da aplicação. Os autores explicam que o Cloudflare Workers diferia demais do Lambda. O resultado diz pouco sobre locais com round trips entre 7 e 70 ms até o primário, que não são amostrados.
- **O teto e a base são estreitos.** Os 84% a 89% são relativos a uma execução inconsistente e sem overhead. A única base consistente é a Virgínia, e o argumento contra as global tables repousa no experimento anterior. Não há descrição de execuções repetidas nem de intervalos.
- **Pequenas inconsistências.** A introdução diz 15 funções onde a Tabela 1 lista 16, e 84% a 88% onde o resumo, o corpo e a conclusão dizem 84% a 89%. A seção de custo chama os 5% de taxa de sucesso da validação, embora em outros trechos seja a taxa de falha. O limiar aparece como 20 ms, como 13 ms ("pode se beneficiar") e como 16 + 2,3 × L ms. Aqui valem os números do corpo.
- **O custo mistura implantações.** A latência usa caches DynamoDB, enquanto o custo assume caches ScyllaDB. Os 2 GB de memória necessários para dois vCPUs aparecem depois dos totais, sem um valor.
- **A generalidade é citada.** Que qualquer aplicação de microsserviços funcione repousa em trabalho anterior, enquanto a avaliação porta handlers pequenos à mão. As 27 de 27 funções analisáveis são animadoras, mas cobrem poucos padrões.

## Pesquisas futuras

- Plataformas serverless próprias que internalizem o protocolo e caches próximos ao usuário mais rápidos, que os autores esperam que melhorem o desempenho.
- Workflows serverless com funções encadeadas, que os autores dizem que teriam desempenho ruim se o Radical fosse aplicado de forma ingênua, e armazenamento serverless com estado, como o [Boki](/papers/boki-stateful-serverless-computing-with-shared-logs), no lugar do DynamoDB, como eles sugerem.
- Batching ou paralelização da aquisição de locks no servidor replicado, para reduzir o tempo mínimo de execução que compensa.
- Injeção de falhas, cargas pesadas em escrita e com chaves quentes, e locais reais de borda ou on-premises, para testar diretamente as afirmações sobre disponibilidade e contenção.
