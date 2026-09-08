---
version: 1.0
updatedAt: 2026-08-20
title: "Estratégias Adicionais do DynamoDB: Unicidade, IDs Sequenciais, e Paginação"
summary: O DynamoDB não tem recurso de restrição de unicidade ou auto-incremento além da chave primária, então unicidade em um segundo atributo precisa de um item marcador mais TransactWriteItems, e IDs sequenciais precisam de um UpdateItem de contador atômico seguido de um PutItem, e paginação é baseada em cursor via LastEvaluatedKey/ExclusiveStartKey, em vez do OFFSET/LIMIT do SQL, uma distinção que ainda se sustenta na documentação atual da AWS, embora o limite de ações do TransactWriteItems tenha crescido de 25 para 100 desde então.
---
## Objective

Aprender três técnicas que "The DynamoDB Book" de Alex DeBrie agrupa em um único capítulo "saco de gato", porque nenhuma delas se encaixa nas estratégias de relacionamento, filtragem, ordenação, ou migração cobertas em outro lugar, mas todas as três aparecem constantemente em aplicações reais. Primeiro, como reforçar unicidade em um atributo que não faz parte da sua chave primária, já que "no DynamoDB, se você quer garantir que um atributo em particular é único, você precisa embutir esse atributo diretamente na estrutura da sua chave primária", e uma chave primária só consegue provar unicidade em si mesma, não em um segundo atributo independente, como um endereço de email. Segundo, como falsificar um ID sequencial auto-incrementado (algo que o DynamoDB não tem suporte nativo) usando um item de contador atômico e uma escrita de dois passos. Terceiro, como paginação no DynamoDB de fato funciona: um cursor construído a partir de `LastEvaluatedKey`/`ExclusiveStartKey`, não o modelo de número de página `OFFSET`/`LIMIT` que a maioria dos desenvolvedores traz consigo do SQL.

## Use Cases

- Um fluxo de cadastro onde tanto um `username` quanto um endereço de `email` precisam ser únicos em toda a aplicação, mas só o username faz parte da chave primária do item.
- Um recurso de rastreamento de projeto ou ticketing (issues do Jira, números de issue do GitHub, números de pedido) onde usuários esperam um número sequencial, legível por humano, por projeto, em vez de um UUID ou KSUID.
- Um endpoint de API retornando o histórico de pedidos de um usuário, mais recente primeiro, onde o cliente precisa buscar "os próximos 10" sem revarrer tudo que já viu.
- Qualquer padrão de acesso onde um `Query` contra uma única item collection é grande demais para retornar em uma ida e volta e precisa ser dividido em um stream de páginas limitadas que um cliente percorre em ordem.

## Deep Dive

### Garantindo unicidade em dois ou mais atributos

O DynamoDB te dá exatamente uma garantia de unicidade nativa: a combinação de partition key e sort key. Nada mais é único por padrão, e nada te impede de escrever dois itens com o mesmo valor de atributo `Email`, desde que suas chaves primárias sejam diferentes.

O exemplo de partida do livro é uma tabela de usuário com chave de forma que o username é garantido único:

- `PK`: `USER#<Username>`
- `SK`: `USER#<Username>`

Um `PutItem` com `ConditionExpression: attribute_not_exists(PK)` na criação é suficiente para garantir que dois usuários não compartilhem um username.

O próximo movimento tentador, mas errado, é dobrar o email na mesma chave, por exemplo, `SK: EMAIL#<email>`. O livro é explícito sobre por que isso falha:

> "é a combinação de uma partition key e sort key que torna um item único dentro da tabela. Usando essa estrutura de chave, você está confirmando que um endereço de email vai ser usado só uma vez para um dado username. Agora você perdeu as propriedades de unicidade originais no username, já que outra pessoa poderia se cadastrar com o mesmo username e um endereço de email diferente!"

O conserto é um segundo item, independente, que existe puramente para ocupar um slot de chave primária, combinado com uma transação, para que ambas as checagens de unicidade tenham sucesso ou falhem juntas:

```python
response = client.transact_write_items(
    TransactItems=[
        {
            'Put': {
                'TableName': 'UsersTable',
                'Item': {
                    'PK': {'S': 'USER#alexdebrie'},
                    'SK': {'S': 'USER#alexdebrie'},
                    'Username': {'S': 'alexdebrie'},
                    'FirstName': {'S': 'Alex'},
                    # ... rest of the user's attributes ...
                },
                'ConditionExpression': 'attribute_not_exists(PK)'
            }
        },
        {
            'Put': {
                'TableName': 'UsersTable',
                'Item': {
                    'PK': {'S': 'USEREMAIL#alex@debrie.com'},
                    'SK': {'S': 'USEREMAIL#alex@debrie.com'}
                },
                'ConditionExpression': 'attribute_not_exists(PK)'
            }
        }
    ]
)
```

Cada `Put` carrega sua própria `ConditionExpression: attribute_not_exists(PK)`, então a transação como um todo só tem sucesso se *nem* o username *nem* o email já estiver em uso. Se qualquer condição falha, `TransactWriteItems` reverte a requisição inteira: nenhum usuário é criado e nenhum email é reservado.

Repare no que é o segundo item: um marcador nu, sem nenhum atributo de usuário de forma alguma. "Você pode fazer isso se você só vai acessar um usuário por um username e nunca por um endereço de email. O item de endereço de email é essencialmente só um marcador que rastreia se o email foi usado." Se você *de fato* precisa buscar um usuário por email, você duplicaria o conjunto completo de atributos de usuário naquele segundo item, em vez disso, mas o livro avisa contra isso: "eu evitaria isso se possível. Agora toda atualização no item de usuário precisa ser uma transação para atualizar ambos os itens. Isso vai aumentar o custo das suas escritas e a latência das suas requisições." A versão de item marcador é a que se deve recorrer, a menos que um padrão de acesso genuíno de "encontrar usuário por email" force a versão duplicada.

### Lidando com IDs sequenciais

Bancos de dados relacionais te dão uma chave primária auto-incrementada de graça; o DynamoDB não. "Com o DynamoDB, não é esse o caso. Você usa identificadores significativos, como usernames, nomes de produto, etc., como identificadores únicos para seus itens." Mas números sequenciais voltados para o usuário ainda são um requisito real (números de issue do Jira, números de issue do GitHub, números de pedido), então o livro constrói um a partir de duas primitivas do DynamoDB: um contador atômico e uma escrita de acompanhamento.

Usando o exemplo estilo Jira do livro (Projects que contêm Issues numeradas sequencialmente), o processo de dois passos é:

```python
resp = client.update_item(
    TableName='JiraTable',
    Key={
        'PK': {'S': 'PROJECT#my-project'},
        'SK': {'S': 'PROJECT#my-project'}
    },
    UpdateExpression="SET #count = #count + :incr",
    ExpressionAttributeNames={"#count": "IssueCount"},
    ExpressionAttributeValues={":incr": {"N": "1"}},
    ReturnValues='UPDATED_NEW'
)

current_count = resp['Attributes']['IssueCount']['N']

resp = client.put_item(
    TableName='JiraTable',
    Item={
        'PK': {'S': 'PROJECT#my-project'},
        'SK': {'S': f"ISSUE#{current_count}"},
        'IssueTitle': {'S': 'Build DynamoDB data model'}
        # ... other attributes ...
    }
)
```

O primeiro passo incrementa `IssueCount` no item Project pai e, via `ReturnValues='UPDATED_NEW'`, entrega de volta o valor pós-incremento na mesma resposta: nenhuma leitura separada é necessária para conhecer a nova contagem. O segundo passo usa esse valor para construir a sort key do novo item Issue (`ISSUE#<n>`) e o escreve. O `UpdateItem` do primeiro passo é atômico independentemente de quantas requisições concorrentes o atingem, então dois issues criados no mesmo instante nunca podem colidir no mesmo número.

O livro é franco sobre o custo desse padrão: "isso não é o ideal, já que você está fazendo duas requisições ao DynamoDB em um único padrão de acesso. No entanto, pode ser uma forma de lidar com IDs auto-incrementados quando você precisa deles." É uma troca deliberada de uma ida e volta extra por um recurso (números de sequência contíguos, voltados para humanos) que o DynamoDB não tem forma nativa de fornecer.

### Paginação

A abordagem do DynamoDB para paginação é um modelo mental genuinamente diferente de `OFFSET`/`LIMIT`, não apenas uma forma de API diferente para a mesma ideia. "Em um banco de dados relacional, você pode usar uma combinação de OFFSET e LIMIT para lidar com paginação. O DynamoDB faz paginação de um jeito um pouco diferente, mas é bem direto." Paginação no DynamoDB é quase sempre paginação através de uma única item collection via `Query`.

Pegue uma tabela de e-commerce onde itens `Order` vivem sob `PK: USER#<username>` com um `OrderId` aproximadamente cronológico (um KSUID) como sort key. A primeira página dos pedidos mais recentes de um usuário:

```python
resp = client.query(
    TableName='Ecommerce',
    KeyConditionExpression='#pk = :pk AND #sk < :sk',
    ExpressionAttributeNames={'#pk': 'PK', '#sk': 'SK'},
    ExpressionAttributeValues={
        ':pk': {'S': 'USER#alexdebrie'},
        ':sk': {'S': 'ORDER$'}
    },
    ScanIndexForward=False,
    Limit=5
)
```

`ScanIndexForward=False` percorre a sort key para trás (mais recente primeiro) e `Limit=5` limita a página a cinco itens. Para buscar a *próxima* página, o cliente precisa de um cursor, e o cursor do DynamoDB é a chave primária do último item que ele viu, enviado de volta na próxima requisição como `ExclusiveStartKey`. O livro embute esse cursor diretamente em uma URL: `.../orders?before=1YRfXS14inXwIJEf9tO5hWnL2pi`, então reemite a query com a condição de sort key ancorada naquele último `OrderId` visto, em vez do valor sentinela `ORDER$`:

```python
resp = client.query(
    TableName='Ecommerce',
    KeyConditionExpression='#pk = :pk AND #sk < :sk',
    ExpressionAttributeNames={'#pk': 'PK', '#sk': 'SK'},
    ExpressionAttributeValues={
        ':pk': {'S': 'USER#alexdebrie'},
        ':sk': {'S': 'ORDER#1YRfXS14inXwIJEf9tO5hWnL2pi'}
    },
    ScanIndexForward=False,
    Limit=5
)
```

A documentação atual da AWS descreve exatamente esse loop, inalterado em relação ao livro: rode um `Query`, cheque a resposta por um `LastEvaluatedKey`, e se presente, passe-o de volta literalmente como o `ExclusiveStartKey` da próxima requisição; quando uma resposta não tem `LastEvaluatedKey`, você chegou ao fim. Uma nuance que o capítulo do livro não explicita, mas que a documentação atual da AWS deixa clara: um `LastEvaluatedKey` não vazio só significa que o `Query` anterior parou em uma fronteira de página (o teto de 1 MB ou seu `Limit`); não garante que mais itens *correspondentes* permaneçam. Isso importa mais quando uma `FilterExpression` está em jogo, já que o teto de 1 MB/`Limit` é reforçado sobre o que é lido *antes* de o filtro rodar, então uma página pode voltar com zero resultados filtrados e ainda carregar um `LastEvaluatedKey` te dizendo para continuar paginando.

A conclusão para quem está acostumado com SQL: não há forma de pular direto para "página 6" da forma que `OFFSET 50 LIMIT 10` permitiria: o cursor do DynamoDB só sabe como continuar a partir do último item que te entregou, não buscar uma posição arbitrária na collection.

## Trade-offs

- **Unicidade via um item marcador é barata; unicidade via um item duplicado não é.** Um item marcador nu (só uma chave primária, sem atributos) custa quase nada extra e só entra em jogo no momento da escrita. Duplicar os atributos do usuário no item de rastreamento de email para que seja lido independentemente significa que toda atualização futura no usuário precisa se tornar uma transação tocando ambos os itens: mais custo de escrita, mais latência, e mais formas de as duas cópias divergirem se quem chama esquecer a segunda escrita.
- **`TransactWriteItems` cobra por duas operações por item, ganhando ou perdendo.** O DynamoDB realiza um prepare e um commit subjacentes para todo item em uma transação, então uma transação de unicidade de dois itens consome capacidade como se fossem quatro escritas, e consome essa capacidade mesmo quando uma `ConditionCheck` falha e a transação inteira é cancelada. Desde setembro de 2022, uma única transação pode agrupar até 100 ações (aumentado das 25 originais), então esse padrão escala para mais de dois atributos únicos sem precisar de múltiplas idas e voltas, mas todo atributo adicional ainda é duas escritas cobradas a mais.
- **IDs sequenciais de contador atômico custam uma ida e volta extra e criam um único item quente.** O padrão `UpdateItem`-depois-`PutItem` não é uma única requisição da forma que uma escrita normal é, e todo item novo naquele projeto ou collection disputa por atualizações atômicas ao *mesmo* item de contador, que se torna um ponto quente de escrita sob alta concorrência. A orientação atual de praticantes em grande parte trata contadores auto-incrementados do DynamoDB como algo a recorrer apenas quando um número sequencial genuinamente voltado ao usuário é exigido, preferindo UUIDs, ULIDs, ou KSUIDs (que o próprio livro já favorece em outro lugar para sort keys cronológicas) sempre que o ID não precisa ser legível por humano e sem lacunas.
- **`SET #count = #count + :incr` e o verbo de expressão de atualização `ADD` são ambos atômicos para contadores numéricos.** O exemplo de contador do livro usa `SET`, enquanto os próprios exemplos de código de contador atômico atuais da AWS usam `ADD #count :incr`. Ambos são atualizações de item único, aplicadas atomicamente, com segurança de corrida idêntica; `ADD` é o verbo mais antigo, mais restrito (apenas números e sets), enquanto `SET` é o mais geral, usado em todo outro lugar nos exemplos de expressão do livro: uma escolha estilística, não uma diferença de corretude.
- **Paginação baseada em cursor é eficiente, mas inflexível.** A paginação `LastEvaluatedKey`/`ExclusiveStartKey` nunca precisa calcular ou pular linhas da forma que `OFFSET` faz em SQL, então permanece rápida e barata não importa quão fundo um cliente pagine. O custo é que só suporta "me dê a próxima página de onde eu parei": não há forma de calcular "página 42" sem ter percorrido as páginas 1 a 41 primeiro, então uma UI que promete navegação pular-para-página-N precisa de um design diferente (ou um índice aproximado, sem cursor), em vez de paginação DynamoDB pura.

## Documentation Links

- [Alex DeBrie, "The DynamoDB Book", v1.0.1 (2020), Chapter 16, "Additional Strategies", p. 269-278](https://www.dynamodbbook.com/) - doc
- [AWS Documentation, Amazon DynamoDB Transactions: How it Works (TransactWriteItems)](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/transaction-apis.html) - doc
- [AWS What's New, Amazon DynamoDB now supports up to 100 actions per transaction (Sept 2022)](https://aws.amazon.com/about-aws/whats-new/2022/09/amazon-dynamodb-supports-100-actions-per-transaction) - doc
- [AWS Documentation, Paginating Table Query Results in DynamoDB](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Query.Pagination.html) - doc
- [AWS Documentation, Update Expressions (SET, REMOVE, ADD, DELETE)](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Expressions.UpdateExpressions.html) - doc
- [AWS Code Library, Use Atomic Counter Operations in DynamoDB with an AWS SDK](https://docs.aws.amazon.com/code-library/latest/ug/dynamodb_example_dynamodb_Scenario_AtomicCounterOperations_section.html) - doc
