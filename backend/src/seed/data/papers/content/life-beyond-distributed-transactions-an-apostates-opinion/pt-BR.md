---
title: "Vida além das transações distribuídas: a opinião de um apóstata"
summary: Em um artigo de posição, Helland defende que aplicações muito grandes são construídas em torno de entidades com chave única que cabem em uma máquina, com transações atômicas só dentro da entidade e mensagens at-least-once entre entidades, de modo que o acordo entre entidades vira workflow de granularidade fina na lógica de negócio.
researchArea: Sistemas distribuídos
keywords: entidades, aplicações agnósticas de escala, escala quase infinita, transações distribuídas, idempotência, atividades, operações tentativas
version: 1.0
updatedAt: 2026-11-19
---

## Resumo

Muitas décadas de trabalho foram investidas na área de transações distribuídas, incluindo protocolos como 2PC, Paxos e várias abordagens de quórum. Esses protocolos dão ao programador de aplicações uma fachada de serializabilidade global. Pessoalmente, investi uma parte nada trivial da minha carreira como defensor convicto da implementação e do uso de plataformas que garantem serializabilidade global. Minha experiência na última década me levou a comparar essas plataformas à Linha Maginot. Em geral, desenvolvedores de aplicações simplesmente não implementam aplicações grandes e escaláveis assumindo transações distribuídas. Quando tentam usá-las, os projetos naufragam, porque os custos de desempenho e a fragilidade as tornam impraticáveis. A seleção natural entra em ação... Em vez disso, as aplicações são construídas com outras técnicas, que não oferecem as mesmas garantias transacionais, mas ainda atendem às necessidades dos negócios.

Este artigo explora e dá nome a algumas das abordagens práticas usadas na implementação de aplicações críticas de grande escala em um mundo que rejeita transações distribuídas. Discutimos a gestão de pedaços de dados de granularidade fina, que podem ser reparticionados ao longo do tempo conforme a aplicação cresce. Também discutimos os padrões de projeto usados no envio de mensagens entre esses pedaços de dados reparticionáveis.

O motivo para iniciar esta discussão é chamar a atenção para novos padrões, por duas razões. Primeiro, acredito que essa consciência pode facilitar o trabalho de quem constrói à mão aplicações escaláveis muito grandes. Segundo, observando os padrões, a indústria talvez consiga criar plataformas que facilitem a construção dessas aplicações.

## Visão geral

Pat Helland escreveu o texto para o CIDR 2007 (Asilomar, de 7 a 10 de janeiro) e o rotula como artigo de posição, com opiniões pessoais que não refletem as do empregador, a Amazon. O contexto é meados dos anos 2000, quando cada vez mais aplicações deixavam de caber em uma máquina ou em um cluster fortemente acoplado. O artigo deixa a alta disponibilidade de lado de propósito e olha só para escalabilidade, partindo do princípio de que transações distribuídas em larga escala não podem ser usadas.

Os protocolos contra os quais ele argumenta são os que o catálogo cobre pelo lado teórico, como [Paxos simplificado](/papers/paxos-made-simple). Do lado prático, há outros sistemas de grande escala da mesma época: o [Bigtable](/papers/bigtable-distributed-storage-system-structured-data), cuja entrada no catálogo descreve atomicidade apenas por linha, e o [Dynamo](/papers/dynamo-amazons-highly-available-key-value-store), que o catálogo descreve como abrindo mão de consistência forte para continuar disponível. O artigo cita o [MapReduce](/papers/mapreduce-simplified-data-processing-large-clusters) do Google, em nota de rodapé, como exemplo de abstração de programação agnóstica de escala. Ao pôr a disponibilidade de lado, ele evita o outro lado do compromisso formalizado na [conjectura de Brewer](/papers/brewers-conjecture-cap-feasibility-web-services).

Vale conhecer antes: o commit em duas fases (2PC) e por que ele pode bloquear quando um nó está fora, o significado de serializabilidade e a diferença entre entrega de mensagens at-most-once, at-least-once e exactly-once.

## Contribuição

- **A entidade.** Uma coleção de dados com chave única que vive dentro de um único escopo de serializabilidade (uma máquina ou um cluster pequeno). Cada dado pertence a exatamente uma entidade, e transações atômicas nunca atravessam entidades, seja na mesma aplicação ou em aplicações diferentes.
- **Camadas agnóstica e consciente de escala.** A camada superior da aplicação é escrita sobre uma abstração agnóstica de escala e nunca assume onde a entidade mora. A camada inferior é consciente de escala: ela mapeia chaves de entidade para máquinas e pode reparticioná-las ao longo do tempo.
- **Mensagens entre entidades.** As mensagens são endereçadas à chave de uma entidade, são enfileiradas de forma transacional junto com a transação do remetente e são entregues at-least-once, podendo se repetir ou chegar fora de ordem.
- **A atividade.** O estado que uma entidade guarda sobre uma entidade parceira, cobrindo as mensagens recebidas e a situação do trabalho compartilhado. Uma entidade tem uma atividade por parceiro.
- **Operações tentativas.** O acordo entre entidades é obtido pedindo a um parceiro que aceite incerteza, com confirmação ou cancelamento depois. O artigo apresenta isso como workflow de granularidade fina, não como um protocolo novo.

## Metodologia

Não há experimento, implementação nem medição. O método é um experimento mental que o autor chama de escala quase infinita: o número de clientes, pedidos, contas e objetos de negócio semelhantes cresce sem limite, enquanto cada objeto individual continua pequeno. A nota de rodapé 2 explicita o que isso significa: dezenas ou centenas de milhares de máquinas, demais para se comportarem como uma grande máquina. O artigo segue então as consequências de três suposições que ele declara afirmadas e não justificadas: que a aplicação tem uma camada superior agnóstica de escala, que escopos disjuntos de serializabilidade são a norma e que a maioria das aplicações recebe mensagens at-least-once.

O argumento avança por exemplos. Particionamento por hash ou por faixa de chaves explica por que não se pode supor que duas entidades estejam na mesma máquina. Um esquema por faixa que por acaso mantém vizinhas juntas passa em um teste que conta com atomicidade e quebra depois de um redeploy. Índices alternativos (um cliente achado por número de seguro social, cartão de crédito ou endereço) mostram por que chaves diferentes não podem ser atualizadas atomicamente. Um pedido que reserva estoque item a item e a compra de uma casa por meio de uma empresa de escrow ilustram atividades e operações tentativas. O autor trata esses casos como padrões já usados na prática, não como invenções.

## Resultados

O artigo traz argumentos e a experiência do autor, não resultados, e não cita nenhum sistema nem número além da escala da nota de rodapé 2. O que ele afirma:

- **Transações distribuídas não sustentam sistemas grandes.** O resumo diz que desenvolvedores "simplesmente não implementam" aplicações grandes e escaláveis assumindo transações distribuídas e que esses projetos naufragam por custo de desempenho e fragilidade. É dito a partir da experiência do autor na última década, sem dados.
- **A entidade é a unidade de atomicidade.** O programador agnóstico de escala deve tratar a entidade como a fronteira de serializabilidade, porque supor mais quebra quando o deployment muda.
- **Índices alternativos não podem ser atômicos com a entidade.** Atualizá-los é workflow assíncrono, e a leitura deles pode estar fora de sincronia com a entidade achada pela chave primária. O artigo diz que isso ficou mais difícil, mas é inevitável.
- **Mensagens precisam tolerar repetição e reordenação.** Uma mensagem que não muda de forma substantiva a entidade é naturalmente idempotente. Caso contrário, a entidade precisa lembrar, de forma durável e por parceiro, que a mensagem foi processada, e devolver a mesma resposta a um pedido repetido. O artigo acrescenta que a eliminação de duplicatas costuma ser feita em filas mais grossas, e não por entidade, e que levar esse conhecimento junto com a entidade reparticionada não é comumente disponível.
- **A incerteza sai dos locks e vai para a semântica de negócio.** Onde transações distribuídas segurariam locks, a lógica de negócio segura estoque reservado ou alocações contra linhas de crédito. Toda operação tentativa acaba confirmando ou cancelando.
- **Uma previsão, não um resultado.** O autor espera que surja middleware novo para esse estilo, como os monitores de TP surgiram nos anos 1970 para o tratamento de terminais.

## Análise crítica

- **Nenhuma evidência além da opinião.** O artigo diz com todas as letras que é um artigo de posição. As afirmações centrais sobre o que os desenvolvedores fazem e por que os projetos naufragam não têm dados, nem sistemas nomeados, nem bibliografia, então não podem ser conferidas a partir do texto.
- **Disponibilidade e replicação ficam de fora.** A introdução ignora a disponibilidade e uma nota de rodapé exclui a replicação para alta disponibilidade, então o artigo não diz nada sobre como escopos disjuntos se comportam sob falha.
- **Não está neste artigo.** Dados de referência e tempo, versões imutáveis, snapshots por data e qualquer estado do tipo bilhete não são discutidos, e o artigo não tem seção que trate filas como forma de projeto além das observações sobre mensagens e eliminação de duplicatas acima. O vocabulário que ele acrescenta ao workflow é entidade, atividade e operação tentativa.
- **Sistemas posteriores revisitam a premissa.** Entradas do catálogo como o [Spanner](/papers/spanner-globally-distributed-database) (transações distribuídas externamente consistentes), o [Calvin](/papers/calvin-fast-distributed-transactions-for-partitioned-databases) e o [FoundationDB](/papers/foundationdb-unbundled-transactional-kv-store) (transações ACID entre chaves arbitrárias) oferecem transações multipartição em escala. Essa é uma comparação feita aqui, não algo que o artigo diga. A afirmação dele é sobre aplicações construídas à mão e sobre a fragilidade de protocolos do tipo 2PC em 2007.

Literatura posterior, que não faz parte do artigo de 2007. Helland republicou o trabalho como "Life Beyond Distributed Transactions" na ACM Queue (vol. 14, n. 5, 2016, DOI 10.1145/3012426.3025012) e na Communications of the ACM (2017, DOI 10.1145/3009826). Não li essas versões, então não sei dizer o que mudou, e o resumo do Crossref para a versão da Queue corresponde aos temas deste artigo. Duas outras peças de Helland aparecem no Crossref: "Immutability Changes Everything" (Queue, 2015), cujo resumo defende guardar e enviar dados imutáveis para coordenar à distância, e "Standing on Distributed Shoulders of Giants" (Queue, 2016), cujo resumo traça paralelos com a física. Li apenas esses resumos. Ligações com Sagas, agregados de domain-driven design ou atores são comuns na prática, mas não são feitas neste artigo, e não conferi fonte para elas aqui.

## Pesquisas futuras

- Plataformas que ofereçam a abstração agnóstica de escala diretamente, incluindo roteamento pela chave da entidade, reparticionamento e eliminação de duplicatas por entidade.
- Quanto do workflow de operações tentativas pode vir de uma biblioteca ou de middleware, em vez de lógica de negócio escrita à mão.
- Onde as transações multipartição são baratas o bastante para alargar a fronteira da entidade, e onde ainda vale a pena mantê-la estreita.
- Detectar, em testes, código que depende de duas entidades estarem na mesma máquina.
- Combinar esse estilo com as preocupações de disponibilidade e replicação que o artigo deixa de lado.
