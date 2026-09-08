---
version: 1.0
updatedAt: 2026-08-20
title: "Modelagem de Dados no DynamoDB: Uma Abordagem Orientada a Padrões de Acesso Primeiro"
summary: A modelagem de dados no DynamoDB roda na direção oposta do design relacional, enumere todo padrão de acesso antes de desenhar uma chave, já que não há joins para recorrer, e o processo de cinco passos do livro (entender a aplicação, DER, padrões de acesso, chave primária, depois índices secundários) hoje é essencialmente a própria orientação oficial da AWS.
---
## Objective

Entender por que a modelagem de dados no DynamoDB roda na direção oposta da modelagem relacional (você enumera todo padrão de acesso *antes* de desenhar uma chave, em vez de normalizar primeiro e consultar flexivelmente depois) e aprender o processo concreto de cinco passos que o livro prescreve: entender a aplicação, desenhar um DER, escrever todos os padrões de acesso, modelar a chave primária da tabela base, e então limpar o que sobrar com índices secundários e streams.

## Use Cases

- Começar um serviço do zero no DynamoDB e precisar de uma sequência defensável a seguir, em vez de traduzir um schema relacional existente tabela por tabela, que o livro sinaliza como o modo de falha: "se você modelar o dado da mesma forma, você não só não vai obter esse benefício, como também vai acabar com uma solução pior do que usar o banco de dados relacional!"
- Conduzir a conversa de requisitos com um PM, gerente de engenharia, ou analista de negócio antes de qualquer tabela existir, porque a lista de padrão de acesso é um artefato de produto tanto quanto técnico.
- Revisar um design onde o time "falsificou" joins em código de aplicação (uma requisição para buscar um registro, depois uma query de acompanhamento para seus registros relacionados) e explicar por que essa cascata é o padrão que o DynamoDB existe para remover.
- Decidir se um dado modelo de fato precisa de uma chave primária composta, usando a regra prática do livro, em vez de padronizar em uma por hábito.
- Auditar uma tabela que cresceu um GSI por padrão de leitura, e consolidar em atributos `GSI1PK`/`GSI1SK` sobrecarregados.

## Deep Dive

### Onde o DynamoDB diverge da modelagem relacional

O livro abre com quatro divergências específicas, e cada uma é uma restrição que molda o processo que se segue.

**Joins não existem.** Joins precisam de grandes quantidades de CPU para combinar unidades díspares de dado, e funcionam melhor quando todo dado relevante está colocalizado em uma única máquina, para que nenhuma chamada de rede seja necessária. Essa exigência de colocalização te limita a escalonamento *vertical* (uma instância maior), em vez de escalonamento horizontal através de muitas menores. A frase de DeBrie é direta: "você não vai encontrar informação sobre joins na documentação do DynamoDB, porque não há joins no DynamoDB." O substituto é **pré-montar seu dado exatamente na forma necessária para uma operação de leitura**, no momento da escrita, em vez de remontá-lo no momento da leitura. E a solução alternativa do lado da aplicação é explicitamente descartada: fazer uma requisição inicial para buscar um registro e depois uma requisição de acompanhamento para registros relacionados é o mesmo padrão caro, só que movido para o seu próprio código.

**Normalização perde uma de suas duas justificativas.** O capítulo percorre uma tabela de loja de roupas, da desnormalizada até a terceira forma normal, para tornar o custo visível: dividir a coluna multivalorada `Categories` em uma tabela `Categories` mais uma tabela de ligação `ItemsCategories` (1NF), mover `Size`/`Price` para uma tabela `ItemsPrices` porque `ManufacturerId`/`ManufacturerName` dependem apenas de `Item`, e não da chave `Item`+`Size` (2NF), e finalmente separar as duas colunas de fabricante porque são transitivamente dependentes uma da outra (3NF). O que começou como uma tabela termina como **cinco tabelas**, ligadas por IDs, e recuperar um item com suas categorias agora precisa de uma query com dois joins:

```sql
SELECT *
FROM items
JOIN items_categories ON items.item = items_categories.item AND items.size = items_categories.size
JOIN categories ON items_categories.category_id = categories.category_id
WHERE items.item = "Nebraska hat"
```

| Forma | Definição | Em bom português |
|---|---|---|
| 1NF | Todo valor de coluna é atômico | Não inclua múltiplos valores em um único atributo |
| 2NF | Sem dependências parciais | Todo atributo que não é chave precisa depender da chave primária inteira |
| 3NF | Sem dependências transitivas | Todo atributo que não é chave depende apenas da chave primária |

Normalização existe por duas razões, e o livro as avalia separadamente. A primeira, conservar armazenamento, era um produto da economia de hardware dos anos 1970 e 1980 e simplesmente sumiu: "no momento em que escrevo isso, eu consigo um GB de armazenamento SSD por $0,10 por mês na AWS." Com a Lei de Moore achatando, *computação* é o fator limitante, então a troca sensata é otimizar para computação armazenando dado pré-moldado para leituras. A segunda razão, integridade de dado, **não** desapareceu. Ela se move: "integridade de dado agora é uma preocupação da aplicação, não do banco de dados." Você precisa decidir antecipadamente onde e quando dado duplicado é atualizado e como você vai encontrar todo registro associado quando isso acontecer.

**Múltiplos tipos de entidade vivem em uma tabela.** Sem joins, buscar um Customer e todos os Orders desse Customer em uma requisição significa que ambos os tipos de entidade compartilham uma tabela e uma chave deliberadamente desenhada. Duas consequências parecem erradas vindas do SQL. Primeiro, você não consegue dar nomes descritivos aos atributos de chave: uma partition key que guarda um `CustomerId` para um item e um `OrderId` para outro não pode ser chamada de `CustomerId`, daí a convenção genérica `PK`/`SK`. Segundo, itens na mesma tabela não vão compartilhar os mesmos atributos. O livro é honesto ao dizer que isso é majoritariamente um não-problema para código de aplicação (a camada de acesso a dados o abstrai), mas genuinamente irritante ao navegar o console ou exportar para um sistema de analytics.

**Filtragem se move do momento de query para o momento de modelagem.** "Acesso a dado é um grande problema de filtragem." A cláusula `WHERE` relacional é descrita como "supremamente poderosa": filtre por propriedades de nível superior, por objetos aninhados via join, por valores dinâmicos como a hora atual, e então como "um luxo que você não pode pagar em escala", porque uma cláusula `WHERE` lê e descarta um grande número de registros, e isso é computação desperdiçada. No DynamoDB, filtragem é embutida no próprio modelo de dados: as chaves primárias da sua tabela e dos seus índices secundários *são* o mecanismo de filtragem, e leituras são "requisições precisas, cirúrgicas." Essa é a troca que o processo inteiro está comprando: "os tempos de resposta de menos de 10 milissegundos que você obtém quando tem 1 gigabyte de dado são o mesmo tempo de resposta que você obtém conforme escala para um terabyte de dado e além."

### O processo, passo a passo

A lista de alto nível do livro:

- Entenda sua aplicação
- Crie um diagrama entidade-relacionamento (DER)
- Escreva todos os seus padrões de acesso
- Modele a estrutura da sua chave primária
- Satisfaça padrões de acesso adicionais com índices secundários e streams

E a frase que governa todos os cinco: **"modelagem de dados no DynamoDB é conduzida inteiramente pelos seus padrões de acesso. Você não vai conseguir modelar seu dado de forma genérica, que permita acesso flexível no futuro. Você precisa moldar seu dado para se encaixar nos padrões de acesso."**

**1. O DER.** Um DER lista as entidades na sua aplicação, geralmente os substantivos que você usa ao falar sobre ela: Users, Notes, Orders, Organizations, com seus atributos, e os relacionamentos entre eles. O exemplo de brinquedo do livro é uma aplicação de Notes: uma entidade `User` com username, email, e data de criação; uma entidade `Note` com título, data de criação, e corpo; um relacionamento um-para-muitos entre eles. O argumento de escala para fazer isso de forma alguma é o modelo GitHub do Capítulo 21: **oito entidades com quatorze relacionamentos entre elas, ainda modeladas em uma única tabela DynamoDB.** DeBrie recomenda construir um DER mesmo para um modelo de dados pequeno, porque isso força você a pensar sobre o dado antecipadamente e deixa um artefato para pessoas novas na aplicação.

**2. Defina seus padrões de acesso, todos eles.** É aqui que o hábito relacional se quebra. Com um banco de dados relacional, "você geralmente consegue simplesmente enviar seu DER direto para o banco de dados": entidades se tornam tabelas, relacionamentos se tornam chaves estrangeiras, e você desenha para queries flexíveis futuras. Não aqui. "Você desenha seu dado para lidar com os padrões de acesso específicos que você tem, em vez de desenhar para flexibilidade no futuro." Então a instrução é ser específico e minucioso, e ir buscar os requisitos com as pessoas (PM, gerente de engenharia, analista de negócio, outros stakeholders) antes de desenhar qualquer coisa.

Duas estratégias para enumerá-los:

- **Centrada em API**: natural quando você está construindo uma API REST. Liste todo endpoint que você quer suportar mais a forma de resposta esperada.
- **Centrada em UI**: melhor para renderização do lado do servidor ou uma API backends-for-frontends. Percorra cada tela e sua URL, e anote toda peça de informação necessária para montar aquela tela.

Registre-os em uma tabela cujo lado direito permanece vazio até você desenhar o modelo:

| Entity | Access Pattern | Index | Parameters | Notes |
|---|---|---|---|---|
| Sessions | Create Session | | | |
| Sessions | Get Session | | | |
| Sessions | Delete Session (time-based) | | | |
| Sessions | Delete Session (manual) | | | |

O lado esquerdo é o requisito; o lado direito é preenchido com a chamada de API do DynamoDB, a tabela ou índice usado, e os parâmetros. Sobre a importância desse passo, o livro não suaviza: "eu não consigo expressar com força suficiente quão importante é esse passo. Você consegue lidar com quase qualquer modelo de dados com o DynamoDB, desde que você desenhe para seus padrões de acesso antecipadamente. O maior problema que vejo usuários enfrentarem é falhar em contabilizar seus padrões antecipadamente, e então se verem presos uma vez que seu modelo de dados solidificou." A alfinetada que acompanha, que as pessoas então culpam o DynamoDB, da mesma forma que você culparia uma chave de fenda por ser ruim para juntar folhas, é o enquadramento do livro para toda reclamação de "o DynamoDB é inflexível."

**3. Modele a estrutura da chave primária.** A chave primária é a fundação da tabela, então vem primeiro, e é modelada em seu próprio subprocesso:

- **Construa um gráfico de entidade.** Copie toda entidade do DER para uma tabela com colunas `PK` e `SK` deixadas em branco: o exemplo do GitHub começa como nove linhas nuas: Repo, Issue, Pull Request, Fork, Comment, Reaction, User, Organization, Payment Plan. Espere que as linhas mudem: entidades desaparecem quando você as representa como um atributo list ou map em um item pai, em vez de itens separados, e entidades são *adicionadas* para relacionamentos muitos-para-muitos ou puramente para reforçar unicidade em um atributo.
- **Decida simples versus composta.** A maioria dos modelos complexos usa uma chave composta, e a regra prática é concreta: se qualquer padrão de acesso recupera múltiplas entidades (*Get all Orders for a User*) ou múltiplos *tipos* de entidade (*Get a Sensor and the most recent SensorReadings for the Sensor*), você precisa de uma chave primária composta.
- **Desenhe o formato de chave por tipo de entidade.** Satisfaça exigências de unicidade primeiro; use qualquer flexibilidade restante para resolver padrões de "buscar muitos".

Dois princípios para o próprio formato de chave. **Considere o que seu cliente vai saber no momento da leitura**: o cliente precisa conhecer a chave primária no momento da leitura, ou pagar por queries extras para descobri-la. Se a URL é `https://api.mydomain.com/users/alexdebrie`, então `username` é seguro para colocar na chave, porque a requisição a carrega. O antipadrão nomeado é enfiar um timestamp `CreatedAt` na chave primária: garante unicidade, mas esse timestamp não vai estar em mãos quando você depois precisar ler ou atualizar o item. **Use prefixos para distinguir tipos de entidade**, tanto para legibilidade no console quanto para prevenir sobreposição acidental de chave entre tipos de entidade com atributos semelhantes:

| Entity | PK | SK |
|---|---|---|
| Customer | `CUSTOMER#<CustomerId>` | `METADATA#<CustomerId>` |
| CustomerOrder | `ORDER#<OrderId>` | `METADATA#<OrderId>` |

Mantenha esses templates no gráfico de entidade conforme você avança. E sobre a sensação de não saber por onde começar: "resista ao impulso de desistir. Mergulhe em algum lugar e comece a modelar. Vai levar algumas iterações, mesmo para usuários experientes de DynamoDB." Com experiência você aprende quais partes do DER são mais complicadas e começa por elas; uma vez que essas estão modeladas, o resto geralmente se encaixa.

**4. Lide com o que sobra com índices secundários e streams.** Depois de a chave primária ser modelada, um lote de padrões de acesso já deveria estar satisfeito, e esse é o objetivo, porque "é melhor fazer o máximo possível com suas chaves primárias. Você não vai precisar pagar por throughput adicional, e não vai precisar considerar problemas de consistência eventual que vêm com índices secundários globais." Tudo o que resta vai para índices secundários, com um aviso: "usuários novos frequentemente querem adicionar um índice secundário para cada padrão de leitura. Isso é excessivo e vai custar mais." Sobrecarregue o índice da mesma forma que você sobrecarrega a chave primária: nomes de atributo genéricos `GSI1PK`/`GSI1SK` atendendo vários padrões de acesso a partir de um índice.

A instrução final do capítulo é incomumente direta: **"você não pode pular esses passos e esperar ter sucesso."**

### Book vs. today: o método se tornou o próprio conselho oficial da AWS, e ferramental preencheu duas lacunas

A metodologia em si envelheceu bem: a própria orientação *NoSQL Design for DynamoDB* da AWS hoje faz o mesmo argumento em quase as mesmas palavras, contrastando o design de schema relacional (construído antes de você conhecer as queries) com o DynamoDB (não comece a desenhar até conhecer as perguntas que o schema precisa responder), e lista identificar padrões de acesso como o passo pré-requisito. Três adições desde abril de 2020 valem a pena conhecer:

> **O PartiQL não é a válvula de escape de flexibilidade que parece.** A AWS adicionou suporte a PartiQL para o DynamoDB no final de 2020, depois que o livro foi lançado, então o capítulo nunca o menciona. Ele te dá declarações `SELECT`/`INSERT`/`UPDATE`/`DELETE` que *parecem* SQL, mas não adiciona joins, e não muda nenhum dos raciocínios acima. Um `SELECT` de PartiQL ainda resolve para um `GetItem`, `Query`, ou `Scan`, dependendo de se sua cláusula `WHERE` atinge a chave, então uma declaração que não restringe a partition key é uma varredura de tabela completa vestindo sintaxe SQL. O processo orientado a padrão de acesso primeiro permanece inalterado.

> **O gráfico de entidade agora tem uma ferramenta de primeira classe.** O NoSQL Workbench for DynamoDB fornece um modelador de dados e visualizador exatamente para os artefatos que este capítulo descreve à mão (entidades, templates de chave, e itens de amostra), e pode aplicar um modelo finalizado a uma tabela real ou local. Os gráficos de papel do livro continuam sendo o exercício de pensamento certo; a ferramenta é onde eles podem viver.
> **A reclamação de exportação para analytics foi endereçada.** O livro nomeia "exportar sua tabela para um sistema externo para processamento analítico" como um custo real de itens heterogêneos em uma tabela. Desde então a AWS adicionou exportação de tabela para o S3 (completa e, depois, incremental) e integrações zero-ETL para o Amazon Redshift e o Amazon OpenSearch, então colocar um conjunto de dados de tabela única em um motor de analytics não exige mais um pipeline feito à mão. Isso não torna o dado exportado bem *moldado*: os itens continuam heterogêneos, mas a encanação não é mais problema seu.

## Trade-offs

- **O método inteiro assume que você já conhece seus padrões de acesso, e em trabalho de fase de descoberta, você não conhece.** Esse é o custo honesto, e não é pequeno. A afirmação mais forte do próprio livro ("você consegue lidar com quase qualquer modelo de dados com o DynamoDB, desde que você desenhe para seus padrões de acesso antecipadamente") é condicional a um pré-requisito que um time pré-product-market-fit frequentemente não consegue satisfazer. Um schema relacional permite adiar essa decisão; o DynamoDB faz você pagá-la no momento do design. Quando os requisitos genuinamente ainda não são conhecíveis, a resposta madura é que isso é uma razão para questionar a escolha de armazenamento de dados para aquele serviço, não uma razão para pular o passo e torcer.
- **Um padrão de acesso genuinamente novo, descoberto depois, é uma migração, não um `ALTER`.** Em SQL, "agora precisamos consultar por email" geralmente é um único `CREATE INDEX` contra dado que já tem a coluna. No DynamoDB, um padrão novo que seus atributos existentes de `PK`/`SK` e chave de GSI não suportam significa fazer backfill de novos atributos em todo item existente antes que o novo índice seja utilizável: uma migração de dado sobre a tabela inteira, escrita e rodada por você, em dado em produção. Adicionar um GSI é barato; adicionar *o atributo que o GSI indexa* a cem milhões de itens existentes não é. É isso que "se verem presos uma vez que seu modelo de dados solidificou" de fato significa na prática.
- **O imposto de modelo mental sobre um time relacional é real e dura mais do que uma sessão de design.** Nomes de atributo genéricos `PK`/`SK`, chaves de string composta `CUSTOMER#123`, vários tipos de entidade intercalados em uma tabela, e nenhum `WHERE` ad-hoc: cada um deles parece mau design para alguém com uma década de instintos relacionais, e a visualização do console reforça ativamente essa impressão. O livro reconhece a fricção ("pode ser esmagador pensar sobre onde começar", "vai levar algumas iterações, mesmo para usuários experientes de DynamoDB"), mas a enquadra como uma curva de aprendizado; em um time, também aparece como revisão de código mais lenta, mais tempo de integração, e uma tentação persistente de um engenheiro novo "limpar isso" de volta para uma tabela por entidade. Orce tempo para isso explicitamente.
- **Desnormalização move integridade de dado do banco de dados para sua aplicação, permanentemente.** O livro é direto sobre isso: a justificativa de armazenamento para normalização está morta, mas a justificativa de integridade não está; ela só muda de dono. Todo atributo duplicado se torna uma escrita de fan-out que você precisa desenhar, testar, e monitorar, e "na maioria das aplicações, isso não vai ser um grande problema, mas pode adicionar complexidade significativa em certas situações." Não há chave estrangeira para te pegar.
- **"Pré-montar no momento da escrita" troca custo e complexidade do caminho de escrita por velocidade do caminho de leitura.** A promessa de menos-de-10ms-em-qualquer-escala é paga do lado da escrita: mais itens escritos, mais atributos duplicados, mais escritas condicionais para mantê-los consistentes. Para uma carga de trabalho intensiva em leitura, essa é uma excelente troca; para uma intensiva em escrita com poucas leituras, você está pagando o imposto de modelagem e coletando menos do benefício.
- **Fazer o máximo possível com a chave primária é certo, mas concentra risco na única coisa que você não pode mudar.** Atributos de chave primária de tabela são imutáveis depois da criação: um GSI pode ser adicionado ou removido depois, o `PK`/`SK` da tabela base não pode. Então o conselho de preferir a chave primária (sem throughput extra, leituras fortemente consistentes disponíveis, sem janela de consistência eventual de GSI) também significa que a decisão menos reversível do design carrega o maior peso. Isso é um argumento para gastar tempo desproporcional no passo 3, não para evitá-lo.
- **Índices sobrecarregados são mais baratos e mais difíceis de ler.** Colapsar muitos padrões de acesso em um único par `GSI1PK`/`GSI1SK` evita pagar e provisionar um índice por padrão, que é o padrão correto. O custo é que nenhum nome de índice ou de atributo diz para que serve; o gráfico de padrão de acesso e o gráfico de entidade deixam de ser documentação boa-de-se-ter e se tornam o único mapa do sistema. Se esses artefatos não forem mantidos, o modelo está efetivamente indocumentado.

## Documentation Links

- [Alex DeBrie, "The DynamoDB Book", v1.0.1 (2020), Chapter 7, "How to approach data modeling in DynamoDB", p. 127-149](https://www.dynamodbbook.com/) - doc
- [AWS Documentation, Best Practices for Designing and Architecting with DynamoDB](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/best-practices.html) - doc
- [AWS Documentation, NoSQL Design for DynamoDB (identify access patterns first)](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/bp-general-nosql-design.html) - doc
- [AWS Documentation, Best Practices for Using Secondary Indexes in DynamoDB](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/bp-indexes.html) - doc
- [AWS Documentation, PartiQL for DynamoDB](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/ql-reference.html) - doc
- [AWS Documentation, NoSQL Workbench for DynamoDB](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/workbench.html) - doc
