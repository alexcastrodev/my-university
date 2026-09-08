---
version: 1.0
updatedAt: 2026-08-20
title: "Do Modelo à Implementação: As Regras Práticas de DeBrie para Construir a Tabela"
summary: Uma vez que um modelo entidade-relacionamento orientado a padrão de acesso primeiro está pronto, DeBrie dá seis regras concretas para transformá-lo em código funcionando, mantenha atributos de indexação (PK/SK) separados dos atributos de aplicação, implemente o modelo de dados só na fronteira da aplicação, nunca reutilize um atributo entre múltiplos índices, marque todo item com um atributo Type, escreva scripts CLI pequenos para depurar padrões de acesso, e só para as maiores tabelas, encurte nomes de atributo para economizar armazenamento.
---
## Objective

Entender as seis regras concretas que Alex DeBrie dá para transformar um modelo entidade-relacionamento orientado a padrão de acesso primeiro, já finalizado (a saída do processo em *[DynamoDB Data Modeling: An Access-Patterns-First Approach](/database-concepts/dynamodb-data-modeling-approach)*), em código de aplicação funcionando e uma chamada `CreateTable` real: manter atributos de indexação separados de atributos de aplicação, empurrar todo código específico do DynamoDB para a fronteira da aplicação, nunca compartilhar um atributo entre dois índices diferentes, marcar todo item com seu tipo de entidade, escrever pequenos scripts de depuração por padrão de acesso, e, só para as maiores tabelas, encurtar nomes de atributo.

## Use Cases

- Revisar um pull request que adiciona uma camada de acesso a dados para um novo serviço apoiado em DynamoDB, e checar se chamadas brutas de `GetItem`/`PutItem` vazam para além do módulo de repositório/dados, para dentro da lógica de negócio: a regra de fronteira do livro tornada concreta.
- Decidir, depois de terminar o gráfico de entidade e o design de chave de [`dynamodb-data-modeling-approach`](/database-concepts/dynamodb-data-modeling-approach), se reutiliza o valor da sort key também como sort key de GSI ("só apontar `GSI1` para `PK` e `SK`") para economizar alguns bytes por item: e saber por que o livro diz para não fazer isso.
- Montar um script de ETL / migração em segundo plano (veja [`dynamodb-migration-strategies-for-single-table-design`](/database-concepts/dynamodb-migration-strategies-for-single-table-design)) e precisar de uma forma barata de selecionar só o tipo de entidade sendo migrado, de uma tabela única sobrecarregada.
- Depurar um incidente de produção onde um `Query` contra um GSI retorna os itens errados, e precisar de uma forma rápida e repetível de reproduzir o padrão de acesso a partir da linha de comando, em vez de reclicar pelo console da AWS toda vez.
- Estimar custo de armazenamento para uma tabela projetada para guardar bilhões de itens, e decidir se encurtar nomes de atributo vale a complexidade adicionada na sua escala real, versus uma tabela menor onde claramente não vale.
- Escrever a chamada `CreateTable` real (ou seu equivalente em CDK/Terraform/CloudFormation) para um modelo que foi desenhado no papel, e querer um checklist curto de pré-voo, em vez de adivinhar tipos de atributo.

## Deep Dive

### Onde este capítulo se encaixa: depois do modelo, antes do código

O livro é explícito sobre a proporção de esforço: *"90% do trabalho de usar o DynamoDB acontece na etapa de planejamento, antes de você escrever uma única linha de código."* Aquela etapa de planejamento (o DER, o gráfico de padrão de acesso, o design de chave primária) é [`dynamodb-data-modeling-approach`](/database-concepts/dynamodb-data-modeling-approach). Este capítulo são os outros 10%: *"em algum momento, no entanto, você precisa passar do modelo para a implementação. Este capítulo inclui orientação sobre como implementar seu modelo de dados DynamoDB no código da sua aplicação."* É um checklist para o momento em que o modelo de papel se torna uma chamada `CreateTable` e uma camada de acesso a dados, não uma técnica de modelagem em si.

### Regra 1: Separe atributos de aplicação de atributos de indexação

Um item puxado diretamente de um single-table design se parece com isto:

```json
{
    "PK": { "S": "USER#alexdebrie" },
    "SK": { "S": "USER#alexdebrie" },
    "GSI1PK": { "S": "ORG#facebook" },
    "GSI1SK": { "S": "USER#alexdebrie" },
    "Username": { "S": "alexdebrie" },
    "FirstName": { "S": "Alex" },
    "LastName": { "S": "DeBrie" },
    "OrganizationName": { "S": "Facebook" }
}
```

DeBrie traça uma linha rígida entre os primeiros quatro atributos e o resto: *"os primeiros quatro atributos estão todos relacionados ao meu modelo de dados DynamoDB, mas não têm significado na lógica de negócio da minha aplicação. Eu me refiro a eles como 'atributos de indexação', já que só estão ali para indexar seu dado no DynamoDB."* `Username`, `FirstName`, e o resto são **atributos de aplicação**: as coisas com que a lógica de negócio de fato se importa.

A dependência só corre em uma direção. Atributos de aplicação têm permissão para informar atributos de indexação (aqui `Username` preenche o template `USER#` para `PK`, `SK`, e `GSI1SK`), mas não o contrário: *"eu recomendo contra ir na direção oposta. Não pense que você consegue remover o atributo Username do seu item, já que ele já está codificado no seu PK. Isso adiciona complexidade e arrisca perda de dado se você mudar seu modelo de dados e atributos de indexação no futuro."* O livro aceita o custo de armazenamento dessa duplicação explicitamente: *"isso vai resultar em tamanhos de item ligeiramente maiores devido a dado duplicado, mas eu acho que vale a pena."*

### Regra 2: Implemente seu modelo de dados bem na fronteira da sua aplicação

O item bruto acima tem dois problemas para quem está escrevendo lógica de negócio contra ele: está bagunçado com atributos de indexação que não significam nada fora do DynamoDB, e todo valor está envolvido em um mapa descritor de tipo (`{"S": "..."}`). O conserto de DeBrie é arquitetural, não cosmético: empurrar toda essa tradução para uma camada estreita:

```python
def get_user(username):
    resp = client.get_item(
        TableName='AppTable',
        Key={ 'PK': { 'S': f'USER#{username}' }}
    )
    return User(
        username=resp['Item']['Username']['S'],
        first_name=resp['Item']['FirstName']['S'],
        last_name=resp['Item']['LastName']['S'],
    )
```

O núcleo da aplicação só vê `data.get_user(username='alexdebrie')` retornando um objeto `User` simples: nunca constrói um `PK`, nunca desembrulha um mapa `{"S": ...}`, nunca sabe que um `GSI1PK` existe. *"Toda interação com o DynamoDB deveria ser tratada no módulo de dados que fica na fronteira da sua aplicação... escreva essa lógica de DynamoDB uma vez, na borda da sua aplicação, e opere em objetos de aplicação o resto do tempo."* Essa é a mesma ideia de fronteira que uma camada de repositório ou DAO te dá sobre um banco de dados relacional; a diferença é quanto trabalho de tradução acontece nessa fronteira, porque o templating de chave e o envolvimento de tipo do DynamoDB não têm equivalente em uma linha SQL comum.

### Regra 3: Não reutilize atributos entre múltiplos índices

Olhando o mesmo item de novo, `SK` e `GSI1SK` guardam o valor idêntico `USER#alexdebrie`. A "otimização" óbvia é parar de escrever `GSI1SK` completamente e definir `GSI1` com um esquema de chave de `GSI1PK` + `SK`: reutilizando a sort key da tabela base como a sort key do índice. DeBrie é direto: *"não faça isso."*

O armazenamento economizado é real, mas pequeno, e o custo é estrutural: *"vai tornar sua modelagem de dados mais difícil. Se você tem múltiplos tipos de entidade na sua aplicação, você vai se enrolar tentando fazer os atributos funcionarem através de múltiplos índices diferentes. Além disso, se você precisar adicionar padrões de acesso adicionais ou migrar dado, isso vai tornar mais difícil."* Sua regra de substituição é mecânica e fácil de reforçar em revisão: *"para cada índice secundário global que você usa, dê a ele um nome genérico de `GSI<Number>`. Então, use `GSI<Number>PK` e `GSI<Number>SK` para seus tipos de atributo."* Um índice, um par dedicado de atributos, sempre: sem conexões cruzadas, mesmo quando dois valores acontecem de coincidir hoje.

### Regra 4: Adicione um atributo `Type` a todo item

Como o tipo de entidade em um single-table design vive dentro do *valor* de `PK`/`SK` (`USER#...` versus `ORDER#...`), não é algo que você consegue filtrar barato ou identificar de relance. O conserto de DeBrie é um atributo de string simples escrito em todo item:

```python
def save_user(user: User):
    resp = client.put_item(
        TableName='AppTable',
        Item={
          'PK': { 'S': f'USER#{User.username}' },
          'SK': { 'S': f'USER#{User.username}' },
          'GSI1PK': { 'S': f'ORG#{User.org_name}' },
          'GSI1SK': { 'S': f'USER#{User.username}' },
          'Type': { 'S': 'User' },
          'Username': { 'S': User.username },
          'FirstName': { 'S': User.first_name},
          'LastName': { 'S': User.last_name},
        }
    )
    return user
```

Ele dá três razões concretas para se importar com isso, além de só se orientar no console da AWS:

- **Migrações.** As estratégias em [`dynamodb-migration-strategies-for-single-table-design`](/database-concepts/dynamodb-migration-strategies-for-single-table-design) frequentemente exigem um job de ETL em segundo plano que varre a tabela e decora itens existentes com novos atributos de indexação, mas geralmente só para um tipo de entidade de cada vez. *"Eu gosto de usar uma expressão de filtro no atributo Type ao varrer minha tabela, para garantir que estou pegando só os itens que preciso. Isso simplifica a lógica no meu script de ETL."*
- **Exportações para analytics.** O DynamoDB não é construído para queries OLAP, então analytics significa exportar para o Redshift ou S3/Athena, e uma única tabela guardando todo tipo de entidade é exatamente a forma errada para um motor de analytics relacional. *"Depois da sua exportação inicial de dado, você vai querer 're-normalizá-lo', movendo seus diferentes tipos de entidade para suas próprias tabelas. Ter um atributo Type torna mais fácil escrever a query de transformação e encontrar os itens certos para mover."*
- **Legibilidade no console.** Uma forma rápida e de baixo custo de saber o que você está olhando enquanto depura no console da AWS.

### Regra 5: Escreva scripts para ajudar a depurar padrões de acesso

Single-table design torna depuração ad-hoc mais difícil do que em um banco de dados relacional: *"seus itens estão todos misturados juntos na mesma tabela. Você está acessando itens do DynamoDB via atributos indexados, em vez dos atributos de aplicação a que você está acostumado na sua aplicação. Por fim, você pode estar usando nomes de atributo encurtados que exigem tradução para mapeá-los de volta aos nomes reais de atributo da sua aplicação."*

O conserto recomendado é um pequeno script CLI por padrão de acesso, sentado em cima do mesmo módulo de dados da Regra 2:

```python
# scripts/get_user.py
import click
import data

@click.command()
@click.option('--username', help='Username of user to retrieve.')
def get_user(username):
    user = data.get_user(username)
    print(user)

if __name__ == '__main__':
    get_user()
```

Rodado como `python scripts/get_user.py --username alexdebrie`, ele imprime o `User` buscado. Para uma busca de item único isso parece exagero, mas o ponto de DeBrie é sobre os padrões de acesso que não são um `GetItem` único: *"se você está recuperando múltiplos itens relacionados de um índice secundário global com condições complexas na sort key, esses pequenos scripts podem ser salvadores. Escreva-os ao mesmo tempo em que está implementando seu modelo de dados."* Escrever o script junto com o código de acesso a dados, em vez de depois de um relatório de bug, é o hábito de fato recomendado.

### Regra 6: Encurte nomes de atributo para economizar armazenamento (avançado, só para as maiores tabelas)

A última regra parece contradizer a Regra 3, mas não contradiz: ela mira em um conjunto diferente de atributos. A Regra 3 diz para nunca compartilhar um atributo de *indexação* entre índices; a Regra 6 diz que você pode abreviar nomes de atributo de *aplicação*, porque a Regra 2 já garante que nada fora da camada de acesso a dados toca esses nomes diretamente:

```python
def save_user(user: User):
    resp = client.put_item(
        TableName='AppTable',
        Item={
          'PK': { 'S': f'USER#{User.username}' },
          'SK': { 'S': f'USER#{User.username}' },
          'GSI1PK': { 'S': f'ORG#{User.org_name}' },
          'GSI1SK': { 'S': f'USER#{User.username}' },
          'u': { 'S': User.username },
          'fn': { 'S': User.first_name},
          'ln': { 'S': User.last_name},
        }
    )
    return user
```

`Username` se torna `u`, `FirstName` se torna `fn`. DeBrie tem o cuidado de sinalizar isso como opt-in, não um padrão: *"esse é um padrão bem avançado, que eu recomendaria só para as maiores tabelas e para aquelas que estão fortemente inseridas na mentalidade DynamoDB... como sua aplicação nunca vai tocar nesses nomes abreviados, é seguro fazer essas abreviações."* O passo de reidratação (transformar `fn` de volta em `first_name` na leitura) pertence inteiramente dentro da mesma camada de fronteira da Regra 2, então o resto da aplicação nunca vê a abreviação. Sua nota de escopo final: *"para a aplicação marginal, os nomes de atributo adicionais não vão fazer uma diferença de custo significativa. No entanto, se você planeja armazenar bilhões e trilhões de itens no DynamoDB, isso pode fazer diferença em armazenamento."*

### Lendo isso como um checklist pré-`CreateTable`

Juntas, as seis regras se resolvem em uma lista curta de pré-voo antes de você de fato chamar `CreateTable` (ou escrever o equivalente em CDK/Terraform/CloudFormation) para um modelo finalizado sob [`dynamodb-data-modeling-approach`](/database-concepts/dynamodb-data-modeling-approach):

1. Todo atributo de chave no seu gráfico de entidade tem nome genérico: `PK`, `SK`, `GSI1PK`, `GSI1SK`, `GSI2PK`, ..., nunca segundo o campo de uma entidade específica.
2. Nenhum esquema de chave de GSI reutiliza um atributo da tabela base ou de outro índice (Regra 3): cada índice ganha seu próprio par dedicado `PK`/`SK`, escrito explicitamente em todo item que pertence a ele.
3. Todo tipo de item no design carrega um atributo `Type` em seu caminho de escrita.
4. Existe exatamente um módulo/pacote onde `AttributeDefinitions`, `KeySchema`, e toda chamada de SDK vivem: nenhuma outra parte da base de código importa o cliente DynamoDB diretamente.
5. Um script de depuração existe (ou é planejado) para todo padrão de acesso não trivial, especialmente os que atingem um GSI com condições de sort key.
6. Encurtamento de nome de atributo é uma decisão deliberada, guiada por escala, não um padrão: pule-o a menos que a tabela esteja genuinamente rumando para bilhões de itens.

### Book vs. today

A mecânica descrita aqui permanece inalterada desde 2020: sobrecarga de `PK`/`SK`, isolamento de atributo de GSI, e o padrão de camada de fronteira são exatamente como os SDKs da AWS e o `CreateTable` ainda funcionam. Duas coisas nas bordas de "de fato escrever a chamada `CreateTable`" valem a pena sinalizar:

> **A AWS agora ativamente direciona tabelas novas para faturamento on-demand, que o livro não menciona de forma alguma.** O parâmetro `BillingMode` da API `CreateTable` ainda tem padrão `PROVISIONED` quando omitido (nesse caso `ProvisionedThroughput` é exigido): isso não mudou. O que mudou é a orientação: a referência de API atual afirma diretamente, *"recomendamos usar `PAY_PER_REQUEST` para a maioria das cargas de trabalho do DynamoDB"*, e o console da AWS agora cria tabelas novas em modo on-demand por padrão. Em 2020, precificação on-demand tinha dois anos e ainda era uma opção secundária; hoje é o ponto de partida recomendado, e o checklist de pré-voo acima deveria incluir "escolha `PAY_PER_REQUEST`, a menos que você já saiba que precisa de capacidade provisionada" junto com as seis regras de DeBrie.
> **O padrão de fronteira da Regra 2 agora tem ferramental de primeira parte em alguns SDKs, mas a disciplina ainda é sua para reforçar.** O Enhanced DynamoDB Client do AWS SDK for Java v2 e camadas semelhantes de mapeador de objetos em outros SDKs conseguem automatizar parte do envolvimento/desembrulho de tipo que a Regra 2 descreve à mão em Python. Isso reduz o boilerplate da camada de fronteira, mas não remove a necessidade de uma: uma classe anotada com `@DynamoDbBean` ainda tem forma DynamoDB, e a disciplina de nunca deixá-la vazar para além da camada de acesso a dados, para dentro da lógica de negócio, é exatamente a Regra 2, com ou sem ferramental.

## Trade-offs

- **A disciplina de camada de fronteira (Regra 2) é fácil de enunciar e fácil de corroer.** Na primeira vez que alguém precisa de "só mais um campo" de uma resposta `GetItem` com pressa, o caminho mais curto é acessar `response['Item']['SomeAttr']['S']` de dentro de um handler, em vez de estender o módulo de dados. Toda instância desse atalho é um lugar onde mudar o design de chave da tabela depois exige caçar através da lógica de negócio, em vez de tocar um arquivo. Trate qualquer import de SDK DynamoDB fora do módulo de acesso a dados designado como um achado de revisão de código, não uma preferência de estilo.
- **A convenção genérica `PK`/`SK`/`GSI<N>PK` (Regras 1 e 3) troca autodescrição por corretude sob mudança.** Uma tabela onde atributos de chave são nomeados segundo a convenção é ilegível no console da AWS sem o gráfico de entidade em mãos: você não consegue dizer o que `PK = "ORG#facebook"` significa sem o documento de mapeamento. Mas a alternativa (nomear a chave de um GSI de `Username`, porque é isso que ele guarda para um tipo de entidade) quebra no momento em que um segundo tipo de entidade precisa daquele mesmo índice, que é precisamente o cenário que single-table design existe para suportar. A ilegibilidade é o custo de manter o design extensível; o gráfico de entidade de [`dynamodb-data-modeling-approach`](/database-concepts/dynamodb-data-modeling-approach) não é documentação opcional aqui, é a única chave.
- **O atributo `Type` é quase de graça e fácil de esquecer sob pressão de tempo.** Custa alguns bytes por item e uma linha extra em todo caminho de escrita, e as três justificativas de DeBrie (filtragem de ETL, re-normalização de analytics, legibilidade de console) não compensam até que uma migração ou uma exportação de fato aconteça, o que pode ser meses depois de a tabela ir ao ar. Pulá-lo no lançamento para economizar uma linha de código é o tipo de decisão que parece de graça até o primeiro script de migração precisar ser escrito sem ele, ponto no qual recuperar o tipo de entidade exige analisar o template `PK` de todo item, em vez de uma expressão de filtro.
- **Scripts de depuração (Regra 5) são um investimento de engenharia real competindo com trabalho de feature, e o retorno é assimétrico por padrão de acesso.** Para um `GetItem` simples por chave primária, um script mal se justifica: você poderia igualmente usar o console ou a CLI da AWS. Para um `Query` contra um GSI com uma condição de sort key `begins_with` ou `between`, reproduzir a requisição exata à mão toda vez é lento e propenso a erro, e é aí que a afirmação de "salvador" do livro se sustenta. Escrever scripts uniformemente para todo padrão de acesso é esforço desperdiçado; pulá-los para os de múltiplas condições é onde times de fato se queimam durante um incidente.
- **Encurtamento de nome de atributo (Regra 6) é a única regra sobre a qual o próprio livro mais recua, e essa ressalva deveria ser levada a sério.** O armazenamento economizado ao transformar `FirstName` em `fn` é genuinamente marginal abaixo de bilhões de itens, enquanto o custo é permanente: todo desenvolvedor lendo um item bruto no console ou nos logs agora precisa de uma tabela de mapeamento de nomes na cabeça, e a lógica de reidratação é mais uma coisa que pode dessincronizar entre os caminhos de leitura e escrita. Aplicar essa regra em uma tabela com alguns milhões de itens está otimizando um custo que ainda não existe, enquanto paga um imposto de compreensão que existe.
- **Nenhuma dessas seis regras é reforçada pelo próprio DynamoDB.** Nada impede uma chamada `PutItem` de escrever um item sem um atributo `Type`, reutilizar um valor de `SK` como uma sort key de GSI, ou ignorar completamente o módulo de acesso a dados: a tabela aceita qualquer forma que você enviar a ela. Essa é a mesma troca que single-table design faz em todo outro lugar: a flexibilidade que permite sobrecarregar uma partition key para pré-juntar dado é a mesma flexibilidade que permite que uma mudança apressada silenciosamente viole toda regra deste capítulo. O checklist substitui uma restrição que o banco de dados não vai te dar, que também é por que ele pertence à revisão de código, não só a um capítulo que você lê uma vez.

## Documentation Links

- [Alex DeBrie, "The DynamoDB Book", v1.0.1 (2020), Chapter 9, "From modeling to implementation", p. 164-173](https://www.dynamodbbook.com/) - doc
- [AWS Documentation, CreateTable API Reference (BillingMode, KeySchema, GlobalSecondaryIndexes)](https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_CreateTable.html) - doc
- [AWS Documentation, Read/Write Capacity Mode (Provisioned vs. On-Demand)](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/HowItWorks.ReadWriteCapacityMode.html) - doc
- [AWS Documentation, Best Practices for Using Secondary Indexes in DynamoDB](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/bp-indexes.html) - doc
- [AWS Documentation, DynamoDB Enhanced Client (AWS SDK for Java 2.x)](https://docs.aws.amazon.com/sdk-for-java/latest/developer-guide/dynamodb-enhanced-client.html) - doc
- [AWS Documentation, Exporting DynamoDB Table Data to Amazon S3](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/S3DataExport.HowItWorks.html) - doc
