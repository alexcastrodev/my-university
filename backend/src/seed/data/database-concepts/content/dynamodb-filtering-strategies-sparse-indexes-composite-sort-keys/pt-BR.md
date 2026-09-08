---
version: 1.0
updatedAt: 2026-08-20
title: "Estratégias de Filtragem no DynamoDB: Índices Esparsos e Sort Keys Compostas"
summary: Filtragem no DynamoDB é mais barata quando acontece via a condição de chave, não depois da leitura, sort keys compostas concatenam um atributo de baixa cardinalidade (como um status enum) com um de alta cardinalidade (como uma data) em uma única sort key, para que um Query filtre em ambos, índices esparsos excluem itens não correspondentes no momento da escrita para que o próprio índice seja o filtro, e FilterExpression é um último recurso, já que é aplicado depois de os itens serem lidos, significando que você paga por todos os itens filtrados fora. Desde novembro de 2025, a AWS adicionou chaves compostas multi-atributo nativas para GSIs, e a técnica de concatenação manual do livro ainda funciona identicamente ao lado disso, mas não é mais estritamente necessária.
---
## Objective

Aprender a filtrar dado no DynamoDB sem pagar duas vezes por isso. O capítulo abre com a restrição que molda tudo o mais nele: "filtragem no DynamoDB é quase exclusivamente focada na sua chave primária. Você precisa entender como modelar, consultar, e indexar suas chaves primárias para tirar o máximo do DynamoDB." O objetivo aqui são as duas técnicas que transformam essa restrição em uma vantagem: **sort keys compostas** (concatenar dois atributos em uma sort key, para que um único `Query` consiga filtrar em ambos) e **índices esparsos** (um GSI que só contém o subconjunto de itens que tem seus atributos de chave, de forma que o próprio índice faz a filtragem), e por que ambos vencem recorrer a uma `FilterExpression`, que o livro avisa "é aplicada depois de os itens serem lidos, significando que você paga por todos os itens que são filtrados fora."

## Use Cases

- O histórico de pedidos de um cliente, onde a UI precisa de "todos os pedidos CANCELLED entre 1º de julho e 30 de setembro": filtrar por dois atributos (status, data) em uma requisição, onde uma sort key simples só na data forçaria varrer todo pedido e descartar não correspondências.
- Uma tabela SaaS com Organizations e Users, onde um padrão de acesso precisa de "todos os Admins nesta Organization": um subconjunto pequeno e raro de uma item collection potencialmente grande, sem ler todo item User para descartar a maioria.
- Uma tabela de e-commerce com Customers, Orders, e InventoryItems intercalados nas mesmas partições, onde um job de marketing precisa de "todo Customer": um tipo de entidade extraído de uma tabela multi-entidade sem um `Scan` de tabela completa.
- Decidir, na etapa de design de API, se um parâmetro de query "filtrar por status" deveria compilar para uma condição de chave (sort key composta) ou uma `FilterExpression`: a escolha que determina se `Limit=10` de forma confiável retorna 10 itens ou exige buscar além do necessário e requisições de acompanhamento.
- Revisar um padrão de acesso existente que se apoia em `FilterExpression` para uma condição de baixa seletividade sobre um conjunto de resultados grande, e reconhecê-lo como uma lacuna de modelagem a consertar com um GSI, não uma otimização de momento de query a ajustar.

## Deep Dive

### Sort keys compostas: concatenação como uma ferramenta de modelagem de dados

Uma sort key composta não é a mesma coisa que uma chave primária composta: o livro tem o cuidado de sinalizar a colisão de nomenclatura: "uma chave primária composta é um termo técnico para quando uma chave primária tem dois elementos: uma partition key e uma sort key. Uma sort key composta é um termo de arte para indicar um valor de sort key que contém dois ou mais elementos de dado dentro dele."

O exemplo motivador: uma tabela de e-commerce onde `CustomerId` é a partition key, e usuários querem um relatório de pedidos filtrado tanto por `OrderStatus` quanto por um intervalo de data. Filtrar só por data (uma sort key simples) retornaria todo status e forçaria descartar a maioria dele depois do fato: "para clientes que fizeram muitos pedidos, isso poderia ser uma operação cara para recuperar todos os pedidos e filtrar os que não correspondem."

O conserto: derive um novo atributo, `OrderStatusDate`, concatenando `OrderStatus` e `OrderDate` com um separador: `CANCELLED#2019-07-01T00:00:00.000000`, e construa um GSI com `CustomerId` como partition key e `OrderStatusDate` como sort key. A query se torna uma única `KeyConditionExpression`:

```python
result = dynamodb.query(
    TableName='CustomerOrders',
    IndexName="OrderStatusDateGSI",
    KeyConditionExpression="#c = :c AND #osd BETWEEN :start and :end",
    ExpressionAttributeNames={
        "#c": "CustomerId",
        "#osd": "OrderStatusDate"
    },
    ExpressionAttributeValues={
        ":c": { "S": "2b5a41c0" },
        ":start": { "S": "CANCELLED#2019-07-01T00:00:00.000000" },
        ":end": { "S": "CANCELLED#2019-10-01T00:00:00.000000" }
    }
)
```

O padrão só funciona em uma direção, e o livro enuncia as duas condições precisamente:

1. "Você sempre quer filtrar por dois ou mais atributos em um padrão de acesso em particular."
2. "Um dos atributos é um valor tipo enum."

Ordem importa por causa de como os valores resultantes ordenam: "repare como nossos itens são ordenados no nosso índice secundário. Eles são ordenados primeiro pelo OrderStatus, depois pelo OrderDate. Isso significa que podemos fazer uma correspondência exata naquele valor e usar filtragem mais granular no segundo valor." Invertê-lo quebra o padrão completamente: "esse padrão não funcionaria ao contrário. Se você fizesse sua sort key composta ser `<OrderDate>#<OrderStatus>`, a alta cardinalidade do valor de OrderDate intercalaria itens de forma que a propriedade OrderStatus se tornaria inútil." O campo de baixa cardinalidade precisa vir primeiro para que itens com o mesmo prefixo se agrupem juntos, para que a condição de intervalo no segundo campo signifique alguma coisa.

O mesmo mecanismo, sem a exigência de enum, alimenta o padrão mais simples de "montar diferentes collections" de mais cedo no capítulo: prefixar sort keys com marcadores de tipo como `ISSUE#`, `REPO#`, `STAR#` dentro de uma item collection, então limitar um `Query` com `#sk <= :sk` ou `#sk >= :sk` ancorado no valor `REPO#` para buscar um Repo mais só seus Issues (ou só suas Stars): filtrar explorando a ordem de classificação, em vez de corresponder a um valor.

### Índices esparsos: o índice que deixa itens de fora de propósito

Um índice secundário só contém itens da tabela base que têm todo atributo no esquema de chave daquele índice: "quando você escreve um item na sua tabela base, o DynamoDB vai copiar aquele item para o seu índice secundário se ele tem os elementos do esquema de chave do seu índice secundário. Crucialmente, se um item não tem esses elementos, ele não vai ser copiado para o índice secundário." Um índice esparso é um onde essa exclusão é deliberada: "um índice esparso é um que intencionalmente exclui certos itens da sua tabela para ajudar a satisfazer uma query."

O livro distingue um índice esparso *incidentalmente* (um GSI sobrecarregado compartilhado por vários tipos de entidade, onde um tipo simplesmente tem menos padrões de acesso e assim está sub-representado) de um *intencionalmente* esparso, que aparece em duas formas:

**1. Filtro global em um subconjunto de um tipo de entidade.** Uma tabela SaaS de Organization/Member precisa de "todos os Users Admin nesta Organization." Em vez de marcar todo User com um papel e filtrar depois da leitura, só Users *Admin* recebem `GSI1SK = "Admin"` escrito de forma alguma; Members regulares simplesmente não têm o atributo, então nunca aterrissam no índice: "nós adicionaríamos um atributo só àqueles itens User que têm privilégios de Administrador em sua Organization... Charlie Munger não [tem um valor de GSI1SK], já que não é admin." O `Query` contra esse GSI retorna nada além de Admins: nenhum passo de filtro necessário, porque os itens não correspondentes nunca foram copiados para dentro.

**2. Isolar um único tipo de entidade através de uma tabela multi-entidade.** Em uma tabela intercalando Customers, Orders, e InventoryItems, marketing quer "todo Customer" para um envio de email em massa. Varrer a tabela base e descartar não-Customers "é um grande desperdício de tempo e da capacidade de leitura da minha tabela." Em vez disso, só itens Customer recebem um atributo `CustomerIndexId`; o GSI com chave nesse atributo acaba contendo Customers exclusivamente, então até um `Scan` contra esse índice estreito é barato, porque não há mais nada nele para percorrer.

Ambas as formas compartilham o mesmo truque: empurrar a decisão de filtragem para o *momento da escrita* (quais itens recebem o atributo de chave), em vez do *momento da leitura* (quais itens são descartados depois de lidos). O livro observa que a segunda forma "não funciona com sobrecarga de índice": precisa de um índice dedicado projetando um tipo de entidade, enquanto a forma de filtro Admin deliberadamente reutiliza um índice já sobrecarregado.

### Por que `FilterExpression` não é a resposta para nenhum dos dois problemas

Ambas as técnicas existem porque a alternativa óbvia (uma `FilterExpression`) filtra *depois* da leitura: "uma expressão de filtro é aplicada depois de os itens serem lidos, significando que você paga por todos os itens que são filtrados fora e está sujeito ao limite de resultados de 1MB antes de seu filtro ser avaliado. Por causa disso, você não pode contar com expressões de filtro para salvar um modelo ruim. Expressões de filtro são, na melhor das hipóteses, uma forma de melhorar levemente a performance de um modelo de dados que já funciona bem." O próprio limiar do livro para quando uma `FilterExpression` ainda é aceitável: "pelo menos uma taxa de acerto de 30-40% no meu filtro OU se o tamanho total do resultado antes do filtro é bem pequeno... se sua taxa de acerto é menor do que isso e você tem um conjunto de resultados grande, você está desperdiçando uma tonelada de capacidade de leitura extra só para jogar tudo fora."

Existe um segundo custo, mais sutil, além da capacidade desperdiçada: `Limit` para de contar *antes* de o filtro rodar, então uma API paginada que promete "10 itens por página" não consegue garantir isso sob uma `FilterExpression`: "você não sabe quantos itens vai precisar buscar para garantir que obtém dez pedidos para retornar ao cliente... você provavelmente vai precisar buscar muito além do necessário ou ter casos onde faz requisições de acompanhamento." Uma sort key composta contorna isso completamente: "você sabe que pode adicionar um parâmetro `Limit=10` na sua requisição e recuperar exatamente dez itens", porque a filtragem já aconteceu via a condição de chave, não depois do fato.

O capítulo encerra sua taxonomia de filtragem com filtragem do lado do cliente: puxar um conjunto de resultados pequeno (sub-1MB), já restringido, para a aplicação e deixá-la lidar com condições arbitrárias, ordenações, ou busca de texto completo. O livro cita Rick Houlihan sobre o raciocínio: "o navegador está sentado em um loop 99% ocioso. Dê a ele algo para fazer!" Isso é explicitamente um último recurso para casos onde o próprio filtro é desajeitado de modelar (as lacunas de livre/ocupado de um calendário) ou o conjunto de dados já é pequeno: não um substituto para as estratégias baseadas em chave acima em uma item collection grande.

### Book vs today: índices esparsos ainda atuais, sort keys compostas ganharam uma alternativa nativa

**Índices esparsos permanecem inalterados e ainda são o padrão recomendado.** O guia de desenvolvedor atual da AWS tem uma página dedicada de boas práticas chamada "Take advantage of sparse indexes", descrevendo o mecanismo idêntico que o livro documenta: os atributos de chave de um GSI agem como um filtro implícito, já que só itens carregando todo atributo de chave são copiados para o índice. A página companheira "Overloading Global Secondary Indexes" também combina precisamente com a terminologia do livro. Nada nessa mecânica mudou desde 2020.

**Sort keys compostas ganharam uma alternativa nativa no final de 2025.** A partir de novembro de 2025, a AWS adicionou chaves compostas multi-atributo para GSIs: partition keys e sort keys podem cada uma ser compostas de até quatro atributos (antes exatamente um cada), para até oito atributos totais em um esquema de chave. O próprio enquadramento da AWS para a mudança endereça diretamente a técnica de concatenação manual que este capítulo ensina: "você não mais precisa concatenar manualmente valores em chaves sintéticas, o que às vezes resulta na necessidade de fazer backfill de dado antes de adicionar novos índices." Com chaves nativas multi-atributo, condições podem ser aplicadas da esquerda para a direita através dos atributos reais (por exemplo, consultar por `UserId`, depois restringir por `Country`, depois `State`, depois `City`), em vez de analisar uma string `OrderStatus#OrderDate` construída à mão.

Isso não invalida o raciocínio do capítulo: a lógica subjacente (campo de baixa cardinalidade primeiro, valores tipo enum funcionam melhor, o objetivo é uma condição de chave, em vez de um filtro) ainda se aplica identicamente a uma chave nativa multi-atributo. O que muda é a *mecânica*: não mais construir e manter um atributo de string derivado à mão no momento da escrita, e nenhuma migração de backfill exigida só para adicionar a dimensão de filtragem extra a um índice existente. O padrão de concatenação do livro permanece válido (e ainda é a única opção em chaves primárias de tabela base e em tabelas/GSIs que não adotaram o novo recurso), mas para um novo GSI em uma tabela usando um SDK atual do DynamoDB, chaves multi-atributo agora são a forma mais direta de obter o mesmo resultado.

## Trade-offs

- **Sort keys compostas compram filtragem multi-atributo ao custo de um atributo derivado, mantido à mão (a menos que usando chaves nativas multi-atributo).** Toda escrita precisa (re)calcular corretamente o valor concatenado, e a ordenação das partes concatenadas é uma decisão de design de mão única: erre a ordenação enum-primeiro e o padrão inteiro colapsa, sem conserto disponível no momento da query; você precisaria fazer backfill de um novo atributo e um novo índice.
- **Índices esparsos trocam disciplina no momento da escrita por baratura no momento da leitura.** A lógica de filtragem se move de "avaliar uma condição em toda leitura" para "decidir se escreve um atributo em cada escrita", o que significa que um bug na lógica do caminho de escrita (uma flag Admin não definida, um `CustomerIndexId` acidentalmente adicionado a um item que não é Customer) silenciosamente corrompe a completude do índice, em vez de aparecer como um erro de query.
- **Ambas as técnicas só são mais baratas do que `FilterExpression` quando a condição de filtro é conhecível no momento da escrita.** Funcionam ótimo para flags de status/papel/tipo conhecidas quando o item é criado ou atualizado. Não ajudam com filtros calculados a partir de dado que a aplicação ainda não tem no momento da escrita (por exemplo, "pedidos que vão ficar atrasados até o fim do dia"): para condições genuinamente dinâmicas, `FilterExpression` ou filtragem do lado do cliente continuam sendo as únicas opções, com seus custos associados.
- **O limiar de taxa de acerto de 30-40% do livro para `FilterExpression` é uma regra prática, não um corte rígido.** É um gatilho razoável para perguntar "isso deveria ser um índice esparso ou uma chave composta em vez disso?", mas a pergunta real é sempre o tamanho da porção descartada, cobrada, da leitura: um filtro com uma taxa de acerto de 80% contra um conjunto de resultados pré-filtro de 5MB ainda é caro em termos absolutos, limiar ou não.
- **Chaves nativas multi-atributo (2025+) removem o fardo de manutenção da concatenação, mas não são retroativas.** Tabelas e GSIs existentes construídos com o padrão de concatenação continuam funcionando exatamente como documentado: nada força uma migração, mas adotar o mecanismo mais novo em um índice existente significa criar um novo GSI e migrar tráfego para ele, o mesmo custo operacional de qualquer outra mudança de índice secundário.

## Documentation Links

- [Alex DeBrie, "The DynamoDB Book", v1.0.1 (2020), Chapter 13, "Strategies for filtering", p. 209-232](https://www.dynamodbbook.com/) - doc
- [AWS Documentation, Take Advantage of Sparse Indexes](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/bp-indexes-general-sparse-indexes.html) - doc
- [AWS Documentation, Best Practices for Using Sort Keys to Organize Data](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/bp-sort-keys.html) - doc
- [AWS Documentation, Overloading Global Secondary Indexes](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/bp-gsi-overloading.html) - doc
- [AWS What's New, Amazon DynamoDB now supports multi-attribute composite keys in global secondary indexes (November 2025)](https://aws.amazon.com/about-aws/whats-new/2025/11/amazon-dynamodb-multi-attribute-composite-keys-global-secondary-indexes) - doc
- [AWS Documentation, Best Practices for Using Secondary Indexes in DynamoDB](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/bp-indexes.html) - doc
- [AWS Documentation, Filter Expressions for Query and Scan](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Query.FilterExpression.html) - doc
