---
version: 1.0
updatedAt: 2026-08-20
title: "Estratégias do DynamoDB para Relacionamentos Muitos-para-Muitos"
summary: Muitos-para-muitos é a forma mais difícil no DynamoDB, porque você quer consultar ambas as direções sem uma tabela de ligação para fazer join, e as quatro estratégias do livro (duplicação rasa, lista de adjacência, grafo materializado, e normalização com múltiplas requisições) formam um gradiente ordenado por quanto dado de relacionamento mutável cada uma consegue tolerar.
---
## Objective

Aprender as quatro estratégias que o livro dá para modelar relacionamentos muitos-para-muitos em uma única tabela DynamoDB (duplicação rasa, lista de adjacência, grafo materializado, e normalização com múltiplas requisições) e, mais importante, aprender a única pergunta que decide entre elas: **a informação sobre o relacionamento é imutável?** Muitos-para-muitos é onde o DynamoDB é mais fraco ("relacionamentos muitos-para-muitos são uma das áreas mais difíceis para o DynamoDB lidar"), e as estratégias são ordenadas por quanta mutabilidade conseguem tolerar, não por elegância.

## Use Cases

- Modelar estudantes e turmas, filmes e atores, ou seguidores de mídia social: os próprios três exemplos do livro para essa forma, onde você precisa consultar *ambos* os lados do relacionamento e não há uma tabela de ligação para fazer join.
- Decidir se um atributo list no item pai é suficiente (duplicação rasa) ou se o relacionamento merece seu próprio item (lista de adjacência), antes de você se comprometer com um template `PK`/`SK` que não pode mudar depois.
- Desenhar o índice secundário invertido / trocado que torna a segunda direção de um relacionamento muitos-para-muitos legível em um `Query`, e saber quando usar `GSI1PK`/`GSI1SK`, em vez de literalmente trocar `PK` e `SK`.
- Revisar um design onde uma mudança de nome de exibição se propaga em milhares de escritas, e reconhecê-lo como exatamente a situação que o livro diz para resolver com normalização mais `BatchGetItem`, em vez de mais duplicação.
- Avaliar se uma carga de trabalho "em forma de grafo" genuinamente pertence ao DynamoDB de forma alguma, ou se o grafo materializado está sendo usado como substituto para um banco de dados de grafo.

## Deep Dive

### Por que muitos-para-muitos é o caso difícil

Um relacionamento muitos-para-muitos é um onde "um tipo de objeto pode pertencer a múltiplas instâncias de um tipo de objeto diferente, e vice-versa." Os três exemplos do livro: estudantes e turmas (um estudante cursa muitas turmas, uma turma tem muitos estudantes), filmes e atores (um filme tem muitos atores, um ator atua em muitos filmes), e amizades de mídia social (todo usuário do Twitter pode seguir e ser seguido por muitos usuários).

A dificuldade é enunciada precisamente: **"relacionamentos muitos-para-muitos são complicados porque você frequentemente quer consultar ambos os lados do relacionamento."** Com estudantes e turmas, um padrão de acesso busca um estudante e a grade daquele estudante; um padrão de acesso *diferente* busca uma turma e todos os estudantes nela. "Esse é o principal desafio dos padrões de acesso muitos-para-muitos."

Em um banco de dados relacional você lida com isso com uma tabela de ligação: cada tabela de objeto tem um relacionamento um-para-muitos com a tabela de ligação, e você percorre ambas para encontrar registros relacionados. O DynamoDB não consegue: "não há joins no DynamoDB, então espalhá-los entre múltiplas tabelas e combiná-los no momento da query não vai funcionar." Então o capítulo inteiro é sobre como *pré-juntar* o dado no momento da escrita, de forma que ambas as direções sejam leituras de requisição única.

### 1. Duplicação rasa

A primeira estratégia duplica apenas um *subconjunto* dos atributos da entidade relacionada no item pai. O exemplo do livro: turmas e estudantes, onde o padrão de acesso é "buscar uma turma e todos os estudantes na turma", mas "ao buscar informação sobre uma turma, você não precisa de informação detalhada sobre cada estudante. Você só precisa de um subconjunto de informação, como um nome ou um ID. Nossa interface de usuário então vai fornecer um link para clicar no estudante, para alguém que quer informação mais detalhada."

Concretamente, o item Class ganha um atributo `Students` do tipo list contendo os nomes dos estudantes matriculados. Esse padrão de acesso agora é um **único `GetItem`**: nem mesmo um `Query`.

A estratégia funciona quando *ambas* as duas propriedades se sustentam:

1. **Existe um número limitado de entidades relacionadas.** Itens do DynamoDB têm um limite de 400 KB, então, exatamente como a estratégia de "desnormalização com um atributo complexo" do capítulo um-para-muitos, isso falha com um número alto ou ilimitado de entidades relacionadas.
2. **A informação duplicada é imutável.** "Se a informação muda frequentemente, você vai gastar muito tempo procurando todas as referências ao dado e atualizando de acordo. Isso vai resultar em necessidades adicionais de capacidade de escrita e potenciais problemas de integridade de dado." O livro sinaliza seu próprio exemplo contra esse teste: copiar o *nome* do estudante está bem porque um nome é imutável (ou perto disso); se o padrão de acesso precisasse da GPA ou data de graduação do estudante, "essa estratégia não funcionaria tão bem."

E uma limitação fácil de perder: **duplicação rasa só resolve uma direção.** Você ainda precisa modelar "buscar um estudante e todas as turmas em que o estudante está matriculado" separadamente. Mas isso é progresso: "usando esse padrão, você removeu um lado do relacionamento muitos-para-muitos. Agora você pode lidar com o outro lado usando uma das estratégias de relacionamento um-para-muitos do capítulo anterior."

### 2. Lista de adjacência

A segunda estratégia é a que generaliza. Você modela cada entidade de nível superior como um item, **você também modela o próprio relacionamento como um item**, e então organiza as chaves de forma que uma única requisição retorne a entidade de nível superior junto com seus itens de relacionamento.

O exemplo do livro é filmes e atores, com três tipos de item:

| Tipo de item | `PK` | `SK` |
|---|---|---|
| Movie | `MOVIE#<MovieName>` | `MOVIE#<MovieName>` |
| Actor | `ACTOR#<ActorName>` | `ACTOR#<ActorName>` |
| Role | `MOVIE#<MovieName>` | `ACTOR#<ActorName>` |

Movie e Actor são os itens de nível superior; **o item Role *é* o relacionamento muitos-para-muitos** entre eles. Como um Role compartilha sua partition key com seu Movie, o item Movie e todos os seus itens Role aterrissam na mesma item collection: então "podemos buscar um filme e os papéis de ator que atuaram no filme com uma única requisição, fazendo uma chamada de API `Query` que usa `PK = MOVIE#<MovieName>` na expressão de condição de chave."

A outra direção vem de um índice secundário que **inverte os elementos da chave composta**: no índice, a partition key é `SK` e a sort key é `PK`. "Agora nosso item Actor está na mesma item collection que os itens Role do ator, permitindo que busquemos um Actor e todos os papéis em uma única requisição."

Isso é uma estrutura de grafo genuína, não uma metáfora: os itens Movie e Actor são nós, os itens Role são arestas, e um `Query` em uma partition key *é* uma travessia de um salto. É isso que a animação abaixo percorre: dois filmes, dois atores, três papéis, sete itens no total: um `Query` na tabela base pega um filme e seus papéis, um `Query` no índice invertido pega um ator e seus papéis.

```viz
type: graph
node MTOY ToyStory 0 1
node MCAST CastAway 0 4
node RTA Role1 2 0
node RTH Role2 2 2
node RCH Role3 2 4
node AALLEN Allen 4 0
node AHANKS Hanks 4 3
edge MTOY RTA directed
edge MTOY RTH directed
edge MCAST RCH directed
edge AALLEN RTA directed
edge AHANKS RTH directed
edge AHANKS RCH directed
---
visit MTOY | Query na tabela base com PK = MOVIE#ToyStory. O primeiro item de volta é o próprio item Movie (SK = MOVIE#ToyStory), carregando os atributos mutáveis -- receita de bilheteria, nota no IMDB.
traverse MTOY RTA | Mesma item collection, então a mesma resposta de Query: Role1, SK = ACTOR#TimAllen. Ordena antes de ACTOR#TomHanks, então vem primeiro.
visit RTA | Um item Role É a aresta. Ele guarda só o que é verdade sobre a atuação -- o personagem interpretado, a ordem de créditos -- e nada disso nunca muda.
traverse MTOY RTH | Próximo item na collection: Role2, SK = ACTOR#TomHanks.
visit RTH | Um Query agora retornou o Movie mais todo Role nele. Sem join, sem uma segunda chamada: a pré-junção foi materializada no momento da escrita.
mark MCAST | Cast Away fica sob uma partition key diferente, então esse Query nunca o leu e nunca foi cobrado por ele.
visit AHANKS | Direção oposta agora: Query no índice invertido (PK do índice = SK, SK do índice = PK) com ACTOR#TomHanks. Seu item Actor, com seus próprios atributos mutáveis, volta primeiro.
traverse AHANKS RTH | No índice, Hanks e seus itens Role compartilham uma item collection. Role2 de novo -- exatamente o mesmo item físico, lido do outro lado.
traverse AHANKS RCH | E Role3, seu papel em Cast Away. Um Query: o ator mais todo filme em que esteve.
visit RCH | Nada foi duplicado para fazer ambas as direções funcionarem. Só as chaves foram reorganizadas pelo índice.
traverse MCAST RCH | Percorrer Role3 de volta na outra direção chega ao item Movie de Cast Away -- o nó Hanks compartilhado é o que torna isso muitos-para-muitos em vez de dois um-para-muitos separados.
visit MCAST | A própria collection de Cast Away na tabela base responde "quem estava em Cast Away" com seu próprio Query único, assim como Toy Story fez.
traverse AALLEN RTA | A collection de Tim Allen no índice guarda só Role1 -- um ator com um crédito é só o caso degenerado da mesma forma.
visit AALLEN | Sete itens, duas chamadas Query, todo nó alcançado. Isso é toda a lista de adjacência.
```

A propriedade que torna esse padrão bom vale a pena enunciar com cuidado, porque é a razão pela qual vence a duplicação rasa: **permite misturar informação mutável e imutável em ambos os padrões de acesso.** O item Movie tem atributos que mudam com o tempo: receita total de bilheteria, nota no IMDB. O item Actor também tem atributos mutáveis, como total de upvotes recebidos. "Com essa configuração, podemos editar as partes mutáveis (os itens Movie e Actor) sem editar os itens Role imutáveis. Os itens imutáveis são copiados em ambas as item collections, dando a você uma visão completa do dado enquanto mantém atualizações no mínimo."

Daí a condição: "esse padrão funciona melhor quando a informação sobre o relacionamento entre os dois é imutável." Um papel de filme é ideal: nada sobre o papel que um ator interpretou muda depois do fato.

Uma nota prática sobre o índice. Inverter `PK` e `SK` completamente é frequentemente chamado de **índice invertido**, mas "se você tem outros itens na sua tabela, você pode não querer inverter o `PK` e `SK` para aqueles itens, já que isso pode não habilitar os padrões de acesso que você quer." O conserto é criar dois novos atributos, `GSI1PK` e `GSI1SK`, guardando os valores invertidos *só* nos itens no relacionamento muitos-para-muitos, e indexar esses. O comportamento de índice esparso faz o resto: itens sem os atributos simplesmente não aparecem.

### 3. Grafo materializado

"Uma estratégia poderosa, mas menos comumente usada." Um grafo é nós e arestas: um nó é um objeto ou conceito (uma pessoa, um lugar, uma coisa), e arestas indicam relacionamentos entre nós. Uma pessoa é um nó, a cidade de Omaha, Nebraska é um nó, e "uma pessoa pode morar em Omaha, Nebraska e esse relacionamento seria representado por uma aresta."

A forma no DynamoDB: crie seus nós como uma item collection na tabela base, então use um índice secundário para **reorganizar esses itens e agrupá-los de acordo com relacionamentos particulares.** O exemplo do livro é o próprio dado do autor: o Node ID `156` é o nó Person para Alex DeBrie, e em vez de um item com todo atributo, ele é quebrado em vários itens: um para o dia em que se casou, um para seu emprego, com o mesmo feito para sua esposa e para Atticus Finch.

O índice secundário é onde isso compensa. No índice, novos agrupamentos aparecem: a partição para a data **28 de maio de 2011** contém uma aresta tanto dele quanto de sua esposa, representando o casamento: "você poderia imaginar outros itens ali representando nascimentos, mortes, ou outros eventos importantes." A partição `JOB|Attorney` guarda dois itens, um por pessoa com aquele emprego. Criticamente, "o `NodeId` está presente em ambos os itens, então você poderia fazer requisições de acompanhamento para reconstituir o nó pai consultando a tabela base pelo Node Id dado": o índice te dá a aresta, a tabela base te dá o nó.

O veredito é útil precisamente porque é sem entusiasmo: "o padrão de grafo materializado pode ser útil para dado altamente conectado que tem uma variedade de relacionamentos. Você consegue rapidamente encontrar um tipo particular de entidade e todas as entidades relacionadas a ela. Dito isso, eu não tenho um exemplo mais aprofundado que mostre o grafo materializado na prática, já que é um padrão bem de nicho."

### 4. Normalização e múltiplas requisições

A válvula de escape, para "quando há informação que é altamente mutável e fortemente duplicada entre seus itens relacionados. Nessa situação, você pode precisar morder a bala e fazer múltiplas requisições ao seu banco de dados."

O exemplo canônico do livro é um grafo de seguidores estilo Twitter. A tela "pessoas que estou seguindo" mostra, para cada usuário seguido, seu **nome de exibição** e **descrição de perfil**: ambos mutáveis. Se cada relacionamento de seguir fosse um item autocontido do DynamoDB carregando aquele dado de exibição, então "precisaríamos atualizar os itens de seguidor de um usuário toda vez que o usuário mudasse seu nome de exibição ou perfil. Isso poderia adicionar uma tonelada de tráfego de escrita, já que alguns usuários têm milhares ou até milhões de seguidores!"

Então: "em vez de ter toda essa sobrecarga de escrita, podemos fazer um pouco de normalização (eca!)":

| Tipo de item | `PK` | `SK` |
|---|---|---|
| User | `USER#<Username>` | `USER#<Username>` |
| Following | `USER#<Username>` | `FOLLOWING#<Username>` |

O item Following é deliberadamente **esparso**: "contém só o básico sobre o relacionamento entre os dois usuários", o username e talvez quando o seguir começou. Leituras então se tornam um processo de dois passos:

1. **`Query`** a item collection do usuário para buscar o item User mais os itens Following iniciais: quem são eles, e a primeira página de quem eles seguem.
2. **`BatchGetItem`** os itens User detalhados para cada item Following encontrado, o que "vai fornecer a informação autoritativa sobre o usuário seguido, como o nome de exibição e perfil."

O livro não disfarça isso: "note que isso não é ideal, já que estamos fazendo múltiplas requisições ao DynamoDB. No entanto, não há forma melhor de lidar com isso. Se você tem relacionamentos muitos-para-muitos altamente mutáveis no DynamoDB, você provavelmente vai precisar fazer múltiplas requisições no momento da leitura."

O segundo exemplo é o que vale a pena roubar, porque é um *híbrido*: um carrinho de compras de e-commerce. Quando um cliente adiciona um item, você duplica parte dele no carrinho: tamanho, preço, número do item. Mas "conforme o usuário vai para o checkout, você precisa voltar à fonte autoritativa para encontrar o preço atual e se está em estoque." Duplicação rasa é boa o suficiente para renderizar o badge do carrinho e um total estimado; a leitura autoritativa acontece uma vez, no momento em que corretude de fato importa.

### O próprio resumo do capítulo

| Estratégia | Notas | Exemplos relevantes |
|---|---|---|
| Duplicação rasa | Boa quando uma entidade pai só precisa de informação mínima sobre entidades relacionadas | Capítulo 20 |
| Lista de adjacência | Boa quando a informação sobre o relacionamento é imutável ou muda com pouca frequência | Capítulo 21 |
| Grafo materializado | Bom para dado altamente interconectado com uma variedade de relacionamentos | Grafo de conhecimento |
| Normalização e múltiplas requisições | Opção de fallback para quando você tem dado altamente mutável contido no relacionamento | Recomendações de rede social |

Leia a coluna "Notas" de cima a baixo e a ordenação é um gradiente de mutabilidade: mínimo e imutável, relacionamento imutável, muitos tipos de relacionamento, altamente mutável.

### Book vs. today: os padrões agora são da própria AWS, e a própria AWS agora nomeia a saída

Nada aqui foi depreciado; este capítulo se lê como atual. Duas coisas se solidificaram desde abril de 2020:

> **Lista de adjacência e grafo materializado são o vocabulário oficial da AWS, com a mesma forma.** A página do Guia de Desenvolvedor do DynamoDB *Best practices for managing many-to-many relationships* documenta exatamente esses dois padrões pelo nome. Seu exemplo de lista de adjacência é faturas e contas, em vez de filmes e atores, mas a mecânica é idêntica: entidades de nível superior são partition keys, "quaisquer relacionamentos com outras entidades (arestas em um grafo) são representados como um item dentro da partição, definindo o valor da sort key para o ID da entidade alvo", e "para procurar todas as faturas que contêm parte de uma conta, crie um índice secundário global na sort key da tabela." A AWS também nomeia a vantagem que o livro enfatiza: **duplicação mínima de dado**. A seção de grafo materializado vai além do que o livro faz, detalhando um atributo `Data` sobrecarregado indexando datas, nomes, lugares, e habilidades em um GSI, um composto `TypeTarget` (`Friend-Person-2`) para buscas reversas, e um aviso explícito para fragmentar grandes agregações (data de nascimento, habilidade) entre partições lógicas para evitar chaves quentes.

> **A AWS agora te diz quando sair.** DeBrie chamou o grafo materializado de "um padrão bem de nicho" e não ofereceu um exemplo mais profundo; a própria orientação atual da AWS agora fecha esse ciclo: "se você precisa consultar conjuntos de dados altamente conectados ou percorrer múltiplos nós (queries multi-hop) com latência de milissegundos, considere usar o Amazon Neptune", um motor de grafo feito sob medida, e recomenda o Neptune especificamente para agregações de relacionamento de segundo e terceiro nível em tempo real. Então a leitura honesta de 2026 da seção 12.3 é: é um padrão legítimo para leituras de grafo de um salto mais reorganização dentro de uma tabela que você já tem, e um sinal para avaliar um banco de dados de grafo se você se pegar querendo dois saltos.

> **O PartiQL não muda nada aqui.** O DynamoDB ganhou suporte a PartiQL no final de 2020, depois que o livro foi lançado, então o capítulo nunca o menciona. Ele te dá declarações que *parecem* SQL, mas não adiciona **nenhum join**, o que significa que a abordagem de tabela de ligação que o capítulo descarta na primeira página continua descartada. A lista de adjacência ainda é como você obtém uma resposta em forma de join.

## Trade-offs

- **A lista de adjacência é o padrão certo, e ainda embute uma direção de query.** É o padrão sobre o qual o livro se apoia para seus dois maiores exemplos trabalhados (Capítulos 19-21) e o que a AWS documenta primeiro, porque duplica quase nada e responde ambas as direções em um `Query` cada. Mas "ambas as direções" custa um GSI, e os atributos de chave do GSI são uma decisão de momento de design: o template `PK`/`SK` da tabela base, `MOVIE#<MovieName>` / `ACTOR#<ActorName>`, codifica qual lado é a partição. Uma terceira direção de relacionamento, ou um relacionamento com um *terceiro* tipo de entidade, é um novo conjunto de atributos de chave, com backfill em todo item Role existente. O que parece um grafo simétrico é na verdade dois padrões de acesso assimétricos que você escolheu de antemão.
- **A condição de imutabilidade da lista de adjacência é na *aresta*, e arestas mudam com mais frequência do que você pensaria.** "Esse padrão funciona melhor quando a informação sobre o relacionamento entre os dois é imutável." Um papel de filme genuinamente se qualifica. Um item de linha de pedido com um status de cumprimento, uma matrícula de turma com uma nota, uma membresia de time com um papel que é promovido: esses não se qualificam, e todo atributo mutável em um item de aresta que também vive em um item de nó é uma escrita de fan-out da qual você agora é dono. Teste seu relacionamento candidato contra a barra do papel de filme honestamente antes de adotar o padrão; "muda com pouca frequência" (a redação da tabela de resumo) está fazendo trabalho real nessa frase.
- **Duplicação rasa atinge o teto rápido, e atinge silenciosamente.** Duas paredes rígidas: o limite de item de 400 KB, e imutabilidade. Nenhuma se anuncia em desenvolvimento: um item Class com doze estudantes em um atributo list funciona lindamente, e também funciona o caminho de código que o escreve. A falha chega em produção ou como uma rejeição de tamanho de item em uma turma popular, ou como um ticket de suporte sobre um nome desatualizado. E só resolve *uma* direção, então é uma meia-estratégia por construção: você sempre a combina com outra coisa. Seu uso certo é o que o livro modela com o carrinho de compras: uma leitura aproximada e barata agora, com uma leitura autoritativa depois, no ponto onde estar errado é caro.
- **O grafo materializado compra expressividade com complexidade no caminho de escrita que você mantém à mão.** Toda aresta é um item, todo item de aresta precisa de seus atributos de GSI definidos corretamente para a reorganização funcionar, e deletar um nó significa encontrar e deletar toda aresta que aponta para ele, sem cascata, sem chave estrangeira, e sem transação que abranja mais itens do que `TransactWriteItems` permite. A própria orientação da AWS adiciona mais: atributos de índice sobrecarregados, um composto `TypeTarget`, e uma estratégia de sharding deliberada para agregações de alta cardinalidade. O "padrão bem de nicho" do livro mais a ausência de um exemplo trabalhado mais aprofundado é um aviso justo: os padrões de leitura são impressionantes, a contabilidade do lado da escrita é inteiramente sua, e travessia multi-hop (a coisa pela qual as pessoas de fato querem um grafo) ainda não é algo que isso te dá.
- **Normalização com múltiplas requisições é uma resposta legítima, não uma falha.** Merece ser nomeada claramente, porque a cultura de single-table design em torno do DynamoDB trata idas e voltas extras como derrota. O livro não trata: "não há forma melhor de lidar com isso." Quando dado de relacionamento é altamente mutável e fortemente duplicado, a amplificação de escrita de mantê-lo atualizado é estritamente pior do que a amplificação de leitura de buscá-lo: uma mudança de nome de exibição que se propaga para um milhão de itens de seguidor não é uma troca que você vence sendo esperto. O custo é real e deveria ser dimensionado honestamente: um `Query` mais um `BatchGetItem` por página de resultados, `BatchGetItem` limitado a 100 itens e 16 MB por chamada, respostas parciais para tratar via `UnprocessedKeys`, nenhuma consistência entre requisições, e um piso de latência de duas idas e voltas sequenciais, em vez de uma.
- **As quatro estratégias não são exclusivas, e os melhores designs as misturam.** O exemplo do carrinho de compras é duplicação rasa *e* uma releitura autoritativa. O exemplo do Twitter é normalização para os campos mutáveis, enquanto o item Following ainda carrega os imutáveis. Escolher por atributo (quais campos são imutáveis o suficiente para duplicar, quais precisam ser lidos da fonte) te leva mais longe do que escolher uma estratégia por relacionamento.
- **Cada uma dessas estratégias move integridade referencial para sua aplicação, e muitos-para-muitos é onde isso mais dói.** Uma tabela de ligação relacional tem duas chaves estrangeiras e uma cascata. Aqui, um item de aresta pode apontar para um nó que não existe mais, um índice invertido pode estar faltando `GSI1PK` em um item que alguém escreveu através de um caminho que esqueceu de defini-lo, e nada no banco de dados vai te dizer. Esse é o custo permanente de pré-juntar no momento da escrita; o caso muitos-para-muitos só tem o dobro de ponteiros para errar.

## Documentation Links

- [Alex DeBrie, "The DynamoDB Book", v1.0.1 (2020), Chapter 12, "Strategies for many-to-many relationships", p. 200-214](https://www.dynamodbbook.com/) - doc
- [AWS Documentation, Best Practices for Modeling Relational Data in DynamoDB](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/bp-relational-modeling.html) - doc
- [AWS Documentation, Best Practices for Managing Many-to-Many Relationships (adjacency list, materialized graph)](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/bp-adjacency-graphs.html) - doc
- [AWS Documentation, Global Secondary Indexes](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/GSI.html) - doc
- [AWS Documentation, BatchGetItem API reference (100 item / 16 MB limits)](https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_BatchGetItem.html) - doc
