---
version: 1.0
updatedAt: 2026-08-20
title: "Índices Secundários e Materialized Views: as Respostas Pré-SAI do Cassandra para Queries Fora da Partition Key"
summary: O índice secundário nativo original do Cassandra (2i) e as materialized views, os dois mecanismos para consultar uma coluna que não é chave de partição antes de o Storage-Attached Indexing existir. O fan-out do 2i em todo o cluster e seus limites rígidos de cardinalidade/tombstone, o conserto parcial por SSTable do SASI, e a troca das materialized views entre desnormalização automática e custo no caminho de escrita, além da imaturidade que o próprio livro admite, exatamente a lacuna que o conceito irmão de SAI fecha.
---
## Objective

Entender os dois mecanismos que o Cassandra oferecia, antes de o Storage-Attached Indexing existir, para consultar uma coluna que não faz parte da chave primária: o índice secundário nativo (2i) e a materialized view. Aprender o que cada um de fato faz mecanicamente, por que `ALLOW FILTERING` aparece em primeiro lugar, e, citando os próprios avisos francos do livro, exatamente onde cada mecanismo quebra em produção. Este conceito é a metade "antes" de um par: o conceito irmão, *Storage-Attached Indexes: Fixing Cassandra's Secondary Index and Materialized View Problem*, é o "depois": o SAI existe especificamente para consertar os problemas documentados aqui.

## Use Cases

- Ler um schema Cassandra existente anterior ao Cassandra 5.0 (ou um que ainda evita o SAI) e precisar reconhecer uma declaração `CREATE INDEX` como um índice 2i legado, em vez de SAI, para saber quais regras de cardinalidade e tombstone se aplicam a ele.
- Diagnosticar um incidente de produção onde queries contra uma coluna indexada começaram a dar timeout ou uma escrita começou a falhar com um erro relacionado a tombstone: ambos são sintomas clássicos do 2i batendo em um de seus modos de falha documentados.
- Decidir, quando um novo padrão de acesso aparece tarde em um projeto, se adiciona outra tabela desnormalizada, adiciona um índice 2i, adiciona uma materialized view, ou recorre ao SAI em vez disso, e conseguir explicar o trade-off em cada direção, em vez de escolher por hábito.
- Ler uma declaração `CREATE MATERIALIZED VIEW` e identificar corretamente a tabela base, a chave primária da view, e por que toda coluna de chave primária precisa de uma cláusula de filtro `IS NOT NULL`.
- Explicar a um líder de time por que materialized views são desabilitadas por padrão em clusters Cassandra modernos, e por que "só adicionar uma materialized view" não é automaticamente a resposta segura que parece ser.
- Migrar um schema antigo do 2i legado ou de materialized views para SAI, o que exige primeiro entender precisamente o que o mecanismo antigo estava fazendo e por que foi escolhido em primeiro lugar.

## Deep Dive

### O problema: quantas tabelas desnormalizadas é demais

O livro monta este capítulo com um cenário familiar: o modelo de dados de uma aplicação de hotel foi originalmente construído em torno de um punhado de padrões de acesso, e então um stakeholder de negócio pede mais formas de buscar: por nome, por localização, por comodidades. O instinto do capítulo de modelagem orientada a query é continuar fazendo o que funcionou: adicionar outra tabela desnormalizada moldada para cada nova query. Isso funciona, mas o livro sinaliza diretamente a pergunta óbvia de acompanhamento: "é razoável começar a perguntar quantas tabelas desnormalizadas é demais." A resposta depende de volume de leitura/escrita e tamanho de dado, mas o ponto real do capítulo é que uma tabela por query não é a única ferramenta disponível. "O Cassandra fornece dois mecanismos que você pode usar como alternativas a gerenciar múltiplas tabelas desnormalizadas: índices secundários e materialized views."

### Índices secundários (2i): o que `ALLOW FILTERING` está de fato te dizendo

A cláusula `WHERE` do Cassandra não é um filtro de propósito geral: ela endereça a partition key e as clustering columns, porque esses são os únicos predicados que o coordenador consegue usar para rotear uma query para um pequeno conjunto de nós. Tente consultar por qualquer outra coisa e o Cassandra recusa diretamente:

```sql
cqlsh:hotel> SELECT * FROM hotels
  WHERE name = 'Super Hotel Suites at WestWorld';
InvalidRequest: Error from server: code=2200 [Invalid query]
message=
  "Cannot execute this query as it might involve data filtering and
thus may have unpredictable performance. If you want to execute this
  query despite the performance unpredictability, use ALLOW
FILTERING"
```

O erro nomeia a válvula de escape, mas o livro é claro sobre o que essa válvula de escape de fato custa: usar `ALLOW FILTERING` significa que "o Cassandra precisaria pedir a todos os nós do cluster que varressem todos os arquivos SSTable armazenados em busca de hotéis correspondentes ao nome fornecido, porque o Cassandra não tem indexação construída naquela coluna em particular": uma varredura de todo o cluster, não uma busca direcionada.

Um índice secundário é a alternativa nativa: "um índice em uma coluna que não faz parte da chave primária."

```sql
cqlsh:hotel> CREATE INDEX ON hotels ( name );
```

Se não nomeado, o cqlsh gera um nome no formato `<tabela>_<coluna>_idx`, visível via `DESCRIBE KEYSPACE` como `CREATE INDEX hotels_name_idx ON hotel.hotels (name);`. Índices também não se limitam a colunas simples: o livro indexa uma coluna de tipo definido pelo usuário (`address`) e uma coluna de coleção (`pois`, um set) da mesma forma, e observa que, especificamente para colunas map, você pode indexar as chaves (`KEYS(addresses)`), os valores (o padrão), ou ambos. Remover um é `DROP INDEX hotels_name_idx;`.

**Por que o 2i não vem de graça.** A razão mecânica é explicada diretamente: "como o Cassandra particiona dados entre múltiplos nós, cada nó precisa manter sua própria cópia de um índice secundário baseado nos dados armazenados nas partições que possui. Por essa razão, queries envolvendo um índice secundário tipicamente envolvem mais nós, tornando-as significativamente mais caras." Não existe um índice global do lado do coordenador: um índice construído com 2i é espalhado pelo cluster da mesma forma que o dado base é, então satisfazer uma query ainda significa perguntar por aí.

O próprio destaque do livro sobre "Armadilhas do Índice Secundário" nomeia três casos específicos em que o 2i não deveria ser usado de forma alguma:

- **Colunas com alta cardinalidade.** "Indexar a coluna `hotel.address` poderia ser muito caro, já que a vasta maioria dos endereços é única": uma coluna quase única significa que o índice mal estreita alguma coisa, mas o custo de fan-out por todo o cluster é pago de qualquer jeito.
- **Colunas com cardinalidade de dados muito baixa.** Indexar algo como uma coluna `title` ("Mr.", "Mrs.") "resultaria em uma linha massiva no índice": um valor de índice agora cobre uma fração enorme da tabela, que é o modo de falha oposto da alta cardinalidade, mas igualmente ruim.
- **Colunas que são frequentemente atualizadas ou deletadas.** "Índices construídos nessas colunas podem gerar erros se a quantidade de dado deletado (tombstones) se acumular mais rápido do que o processo de compaction consegue acompanhar." Essa é a armadilha operacional que de fato aciona alertas: um índice 2i em uma coluna com muita rotatividade não degrada graciosamente, eventualmente começa a falhar completamente.

O veredito resumido do livro é direto: "para performance de leitura ideal, designs de tabela desnormalizada ou materialized views... geralmente são preferidos ao uso de índices secundários. No entanto, índices secundários podem ser uma forma útil de suportar queries que não foram consideradas no design inicial do modelo de dados." Em outras palavras: um fallback para a query que você não planejou, não uma ferramenta padrão de modelagem.

**SASI, a própria tentativa de conserto do livro.** O livro também documenta a primeira tentativa do Cassandra de consertar o 2i, antes de o SAI existir: SASI (SSTable Attached Secondary Index), um tipo de índice experimental introduzido no Cassandra 3.4, desenvolvido pela Apple e lançado como uma implementação open source da API de índice secundário do Cassandra. O nome já entrega a ideia arquitetural que o SAI mais tarde levaria adiante: "índices SASI são calculados e armazenados como parte de cada arquivo SSTable, diferindo da implementação original do Cassandra, que armazena índices em tabelas separadas, 'escondidas'." O SASI adicionou capacidades reais que o 2i nunca teve (buscas de desigualdade e busca de texto `LIKE` em colunas indexadas), mas o livro também é honesto sobre seus limites: "embora índices SASI de fato performem melhor do que índices tradicionais ao eliminar a necessidade de ler de tabelas adicionais, ainda exigem leituras de um número maior de nós do que um design desnormalizado." O SASI estreitou a lacuna; não a fechou. É essa lacuna que o SAI, coberto no conceito irmão, foi construído para fechar de verdade: anexando o índice ao armazenamento no nível do motor, em vez de acoplá-lo como uma implementação de índice customizada.

### Materialized views: desnormalização que o Cassandra gerencia para você

Materialized views são a outra resposta pré-SAI do livro, mirando especificamente no caso em que o 2i se sai pior: "materialized views foram introduzidas para ajudar a resolver algumas das deficiências dos índices secundários que discutimos. Criar índices em colunas com alta cardinalidade tende a resultar em má performance, porque a maioria ou todos os nós do anel são consultados." Em vez de um índice espalhado pelo cluster, uma materialized view é "views pré-configuradas que suportam queries": uma tabela real, separada, que o Cassandra mantém sincronizada com a tabela base automaticamente, para que a aplicação não precise escrever em duas tabelas manualmente a cada atualização.

Aqui está o exemplo trabalhado do livro, construindo `reservations_by_confirmation` como uma view sobre `reservations_by_hotel_date`:

```sql
CREATE MATERIALIZED VIEW reservation.reservations_by_confirmation
AS
SELECT * FROM reservation.reservations_by_hotel_date
WHERE confirm_number IS NOT NULL and hotel_id IS NOT NULL and
  start_date IS NOT NULL and room_number IS NOT NULL
PRIMARY KEY (confirm_number, hotel_id, start_date, room_number);
```

Percorrendo as cláusulas: o nome vem primeiro (`reservations_by_confirmation`), `FROM` nomeia a tabela base, `PRIMARY KEY` nomeia a própria chave primária da view, e `AS SELECT` (aqui um wildcard) escolhe as colunas a carregar. Duas restrições importam mais do que a sintaxe:

- **A chave primária da view precisa incluir toda coluna da chave primária da tabela base.** "Essa restrição impede que o Cassandra colapse múltiplas linhas na tabela base em uma única linha na materialized view, o que aumentaria bastante a complexidade de gerenciar atualizações." O padrão comum é a nova coluna filtrável como a partition key da view, seguida pelas próprias colunas de chave primária da tabela base como clustering columns.
- **Toda coluna de chave primária precisa de um filtro explícito**, mesmo um `IS NOT NULL` trivial: a cláusula `WHERE` não é decoração opcional aqui, é uma exigência rígida para toda coluna nomeada em `PRIMARY KEY`.

`reservations_by_confirmation` é o exemplo do livro de um encaixe genuinamente bom: números de confirmação são tão próximos de únicos por linha quanto uma coluna consegue ser, que é exatamente a forma que torna o 2i caro e uma materialized view barata em comparação.

**O que isso custa.** A sincronização não é grátis: "materialized views incorrem em um impacto de performance nas escritas da tabela base, porque algumas leituras são exigidas para manter essa consistência." Internamente, o livro observa, atualizações de view são implementadas usando batching: toda escrita na tabela base potencialmente se ramifica em mais trabalho para manter a cópia da view correta. A troca que o livro enquadra: escritas mais caras, em troca de não ter o código da aplicação mantendo manualmente múltiplas tabelas desnormalizadas sincronizadas ele mesmo.

**A própria ressalva do livro sobre maturidade.** Mesmo apresentando materialized views como a resposta ao problema de cardinalidade do 2i, o livro inclui um destaque que, em retrospectiva, soa como um sinal de alerta: "a implementação inicial de materialized views na versão 3.0 tem algumas limitações na seleção de colunas de chave primária e filtros. Existem vários issues de Jira atualmente em progresso para adicionar capacidades, como múltiplas colunas que não são chave primária nas chaves primárias de materialized view... ou usar agregações em materialized views... se você está interessado nesses recursos, acompanhe os issues de Jira para ver quando serão incluídos em um lançamento." Isso é o livro, em 2022, descrevendo um recurso ainda sob conserto ativo anos depois de sua introdução na 3.0, e é exatamente essa fragilidade que levou o projeto a desabilitar materialized views por padrão (`materialized_views_enabled: false`) a partir do Cassandra 4.0, e mantê-las marcadas como experimentais até hoje. O próprio exemplo de reserva do capítulo mostra a solução alternativa que os times de fato usam: `reservations_by_hotel_date` e `reservations_by_guest` são construídas como tabelas desnormalizadas manuais comuns, e só `reservations_by_confirmation` (o caso em que materialized views se encaixam melhor) é construída como uma view, uma ressalva explícita, em vez de um endosso geral.

### Onde isso te deixa

Coloque os dois mecanismos lado a lado e a causa raiz compartilhada é a mesma que o livro nomeia no início do capítulo: uma cláusula `WHERE` em uma coluna que não é chave de partição não tem uma resposta eficiente e nativa do motor sem ajuda. O 2i te dá essa ajuda, mas paga por ela com fan-out em todo o cluster e limites rígidos de cardinalidade em ambos os extremos. Materialized views te dão desnormalização automática, mas pagam por isso com custo no caminho de escrita e uma implementação que o próprio livro sinaliza como inacabada. Ambos eram reais, úteis, e distribuídos por anos antes de o Cassandra ter algo melhor, que é exatamente a lacuna que o Storage-Attached Indexing foi construído para fechar. O SAI, coberto no conceito irmão, conserta os problemas de custo-por-coluna e de precipício de cardinalidade do 2i anexando o índice ao próprio motor de armazenamento, em vez de a uma tabela escondida, e remove a razão de recorrer à maquinaria frágil de consistência de uma materialized view na maioria dos casos em que o objetivo era simplesmente "deixe-me filtrar nesta coluna." Os mecanismos deste conceito não são trivialidades obsoletas, porém: ainda são o que você vai encontrar lendo schemas mais antigos, e o 2i em particular ainda é a única opção em um cluster que ainda não roda uma versão do Cassandra capaz de SAI.

## Trade-offs

- **O modelo de custo do 2i pune ambos os extremos de cardinalidade, e o livro diz isso sem suavizar.** Colunas de alta cardinalidade pagam fan-out completo pelo cluster por um punhado de correspondências; colunas de baixa cardinalidade produzem linhas de índice de tamanho excessivo. Não existe um ponto ideal de cardinalidade onde o 2i seja grátis, apenas uma faixa intermediária onde é tolerável.
- **O modo de falha de tombstone do 2i é uma armadilha operacional, não um incômodo de performance.** Uma coluna que é frequentemente atualizada ou deletada pode empurrar a contagem de tombstones de um índice além do que a compaction consegue acompanhar, e o livro é explícito ao dizer que isso "pode gerar erros": não apenas queries lentas, mas falhas de query uma vez que o índice degradou o suficiente.
- **Materialized views trocam custo de escrita por automação de consistência, e o livro precifica essa troca honestamente.** "Materialized views incorrem em um impacto de performance nas escritas da tabela base, porque algumas leituras são exigidas para manter essa consistência": toda escrita na tabela base é potencialmente mais cara, em troca de não escrever código de desnormalização manualmente.
- **O próprio destaque do livro sobre "issues de Jira atualmente em progresso" é um sinal, não uma nota de rodapé.** Apresentar as lacunas conhecidas de um recurso como coisas para "acompanhar", em vez de comportamento estabelecido, é o livro sinalizando, em tempo real, que materialized views eram menos maduras do que a prosa ao redor sugere: uma cautela mais tarde validada pelo recurso ser desabilitado por padrão a partir do Cassandra 4.0.
- **O SASI mostra que "anexar o índice à SSTable" era a ideia certa anos antes de o SAI existir, mas uma versão parcial da ideia certa ainda é parcial.** O SASI removeu o overhead de tabela escondida separada do 2i e adicionou capacidades reais (desigualdade, `LIKE`), mas o livro ainda registrou que ele precisava de "leituras de um número maior de nós do que um design desnormalizado." Ser experimental e contribuído pela Apple, em vez de um recurso central e GA, também significou que nunca ganhou a adoção ou o suporte de longo prazo que o SAI tem.
- **Nenhum dos dois mecanismos revoga a modelagem centrada em partição: ambos são explicitamente enquadrados como o fallback, não o padrão.** O próprio veredito do livro ("designs de tabela desnormalizada ou materialized views... geralmente são preferidos ao uso de índices secundários... índices secundários podem ser uma forma útil de suportar queries que não foram consideradas no design inicial do modelo de dados") se aplica com apenas um pouco menos de força às próprias materialized views. Recorra a qualquer um dos mecanismos para aparar uma cauda longa de padrões de acesso secundários, não para substituir o design orientado a query para uma query genuinamente quente.

## Documentation Links

- [Jeff Carpenter and Eben Hewitt, "Cassandra: The Definitive Guide", Revised 3rd Edition (O'Reilly, 2022), Chapter 7, "Extending Designs" (Secondary Indexes, SASI, Materialized Views)](https://www.oreilly.com/library/view/cassandra-the-definitive/9781492097143/) - doc
- [Apache Cassandra Documentation, When to Use an Index (legacy secondary indexes, 2i)](https://cassandra.apache.org/doc/latest/cassandra/developing/cql/indexing/2i/2i-when-to-use.html) - doc
- [Apache Cassandra Documentation, CQL Indexing Overview](https://cassandra.apache.org/doc/latest/cassandra/developing/cql/indexing/indexing-overview.html) - doc
- [Apache Cassandra Documentation, CQL Materialized Views](https://cassandra.apache.org/doc/latest/cassandra/developing/cql/mvs.html) - doc
- [Apache Cassandra Jira, CASSANDRA-9928 (Support multiple non-primary key columns in materialized view primary key)](https://issues.apache.org/jira/browse/CASSANDRA-9928) - doc
