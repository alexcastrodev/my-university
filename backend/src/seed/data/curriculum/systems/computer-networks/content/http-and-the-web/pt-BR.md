---
version: 1.0
updatedAt: 2026-09-06
title: "HTTP e a Web"
summary: "O ciclo de requisição e resposta do HTTP, a sua ausência deliberada de estado (e os cookies como o contorno acoplado depois) e as conexões persistentes versus não persistentes: o protocolo concreto da camada de aplicação que todo exemplo resolvido mais adiante nesta disciplina rastreia para baixo, por toda camada inferior."
---
## Objetivos de Aprendizagem

- Descrever o ciclo de requisição e resposta do HTTP, e enunciar em qual protocolo de transporte ele se apoia e por quê.
- Explicar a ausência de estado do HTTP, e explicar que problema os cookies resolvem e como, mecanicamente, eles o resolvem.
- Distinguir as conexões HTTP persistentes das não persistentes, e explicar o custo da camada de transporte que as conexões não persistentes pagam repetidamente.
- Identificar as partes de uma mensagem real de requisição e de resposta HTTP: linha de requisição/linha de status, cabeçalhos e corpo.
- Explicar por que o HTTP é o protocolo concreto pelo qual os conceitos posteriores das camadas de transporte e de rede desta disciplina são rastreados, no capstone.

## Contexto e Motivação

Tendo estabelecido, no conceito anterior, que a Web é construída sobre uma arquitetura cliente-servidor, este conceito desenvolve o protocolo de fato que essa arquitetura roda: o HTTP, o HyperText Transfer Protocol. O HTTP é deliberadamente simples (um protocolo de requisição e resposta, sem nenhuma noção embutida de uma "sessão" de vários passos), e essa simplicidade é uma escolha de projeto real, e não um descuido, que este conceito examina diretamente por meio da ausência de estado do HTTP e do mecanismo de cookies inventado para contorná-la. O HTTP também é escolhido, ao longo do restante desta disciplina, como o exemplo recorrente por baixo do qual todo mecanismo de camada inferior é eventualmente rastreado: quando o capstone desta disciplina percorre uma requisição de ponta a ponta pela resolução DNS, pelo handshake do TCP, pelo roteamento IP e pelo enquadramento da camada de enlace, é uma requisição HTTP que faz o percurso, justamente porque o HTTP é concreto, familiar e fica bem no topo da pilha: o ponto de partida natural para rastrear tudo o que precisa acontecer por baixo dele.

## Teoria Central

### O ciclo de requisição e resposta

O HTTP é um protocolo de requisição e resposta: um cliente (tipicamente um navegador) envia uma mensagem de requisição HTTP a um servidor, e o servidor responde com uma mensagem de resposta HTTP. O próprio HTTP define só o formato dessas mensagens e as regras para trocá-las; ele depende inteiramente da camada de transporte (especificamente do TCP, na esmagadora maioria das implantações reais) para de fato estabelecer uma conexão e entregar os bytes da requisição e da resposta de forma confiável e em ordem entre cliente e servidor. O HTTP é, neste sentido, um protocolo genuinamente simples construído diretamente sobre um serviço da camada de transporte muito mais complexo, que ele toma inteiramente como garantido.

### Ausência de estado

O HTTP é sem estado (stateless): o servidor não mantém informação alguma sobre um cliente entre requisições separadas, por projeto. Cada requisição é processada inteiramente por conta própria, independentemente de qualquer requisição anterior do mesmo cliente. Esta é uma simplificação deliberada: um servidor sem estado não precisa lembrar nada sobre milhões de clientes entre as suas requisições, o que mantém o projeto do servidor, e a sua capacidade de se recuperar de um travamento (ele não tem estado de sessão a perder), muito mais simples do que uma alternativa com estado permitiria.

### Cookies: o contorno

A ausência de estado é uma limitação real para muitas aplicações genuinamente úteis (um carrinho de compras, uma sessão logada) que precisam que o servidor reconheça o mesmo cliente por várias requisições. Os cookies resolvem isso sem abandonar a ausência de estado no nível do protocolo: o servidor inclui um cabeçalho `Set-Cookie` numa resposta, atribuindo ao cliente um identificador único; o navegador o guarda e o inclui automaticamente num cabeçalho `Cookie` em toda requisição subsequente àquele servidor. O servidor então consulta o seu próprio estado do lado do servidor (um registro de sessão, um carrinho de compras) indexado por esse identificador. O próprio HTTP continua sem estado (nenhuma requisição depende de o servidor lembrar algo de uma requisição anterior sem que o cliente forneça de novo o cookie), mas a combinação de um cookie com estado do lado do servidor produz a experiência prática de uma sessão com estado em cima dele.

### Conexões persistentes vs. não persistentes

Uma conexão HTTP não persistente abre uma conexão TCP nova para cada objeto pedido (a página HTML base, depois uma conexão separada para cada imagem, cada folha de estilos), fechando a conexão depois que cada objeto é entregue. Uma conexão persistente, o padrão no HTTP/1.1 e posteriores, mantém uma única conexão TCP aberta através de múltiplas requisições e respostas em sequência, evitando o overhead de estabelecer uma conexão TCP novinha (com o seu próprio three-way handshake, coberto mais adiante nesta disciplina) para cada objeto de uma página que pode referenciar dezenas deles.

### A estrutura das mensagens de requisição e resposta

Uma requisição HTTP real tem uma linha de requisição (método, URL, versão do HTTP; ex.: `GET /index.html HTTP/1.1`), um conjunto de linhas de cabeçalho (`Host:`, `User-Agent:`, `Cookie:` e outros), uma linha em branco e um corpo opcional (presente em métodos como `POST`). Uma resposta HTTP real tem uma linha de status (versão do HTTP, um código de status numérico e uma frase curta de motivo; ex.: `HTTP/1.1 200 OK`), linhas de cabeçalho (`Content-Type:`, `Content-Length:`, possivelmente `Set-Cookie:`), uma linha em branco e o corpo da resposta (o conteúdo de fato pedido).

## Exemplos Resolvidos

### Exemplo 1: Uma requisição e uma resposta HTTP reais

```text
Requisição (cliente para servidor):

GET /index.html HTTP/1.1
Host: www.example.com
User-Agent: Mozilla/5.0
Cookie: session=a1b2c3d4

Resposta (servidor para cliente):

HTTP/1.1 200 OK
Content-Type: text/html
Content-Length: 3419
Set-Cookie: session=a1b2c3d4; Max-Age=3600

<html>...o conteúdo de fato da página...</html>
```

O código de status `200` significa sucesso. Outros códigos comuns: `301` (movido permanentemente), `404` (não encontrado), `500` (erro interno do servidor). A linha de status sozinha, antes mesmo de qualquer corpo ser lido, diz ao cliente como interpretar o que vem a seguir.

### Exemplo 2: Os cookies resolvendo a ausência de estado, passo a passo

```text
1. Um navegador envia uma primeira requisição a www.example.com sem
   cabeçalho Cookie (nenhum cookie definido ainda).
2. O servidor não tem como distinguir este cliente de qualquer outro
   cliente novo -- a ausência de estado significa que ele não guarda nada
   de requisições anteriores de ninguém. Ele gera um identificador de
   sessão novo e responde com Set-Cookie: session=xyz789.
3. O navegador guarda "session=xyz789" associado a example.com.
4. Em toda requisição subsequente a example.com, o navegador inclui
   automaticamente Cookie: session=xyz789.
5. O servidor consulta o seu próprio registro do lado do servidor indexado
   por "xyz789" (ex.: "esta sessão tem 2 itens no carrinho de compras") e
   responde de acordo.
```

Em ponto algum o próprio protocolo HTTP carrega qualquer noção de uma sessão de várias requisições: toda requisição individual ainda é processada como uma unidade independente e sem estado; a aparência de uma sessão com estado é produzida inteiramente pelo identificador do cookie mais a consulta do lado do servidor, sobrepostos.

### Exemplo 3: Contando conexões, persistentes vs. não persistentes

Uma página web consiste em um arquivo HTML e 10 imagens embutidas, todos servidos pelo mesmo servidor.

```text
HTTP não persistente: 11 conexões TCP separadas são abertas e fechadas --
  uma para o arquivo HTML, uma para cada uma das 10 imagens -- cada uma
  pagando o seu próprio custo de estabelecimento de conexão (o three-way
  handshake, coberto mais adiante nesta disciplina) antes que qualquer
  byte de fato daquele objeto seja enviado.

HTTP persistente: 1 conexão TCP é aberta uma vez e reutilizada para as
  11 requisições e respostas em sequência (ou em paralelo, sobre essa
  mesma conexão, com pipelining) -- o custo de estabelecimento de conexão
  é pago uma vez, e não 11 vezes.
```

Esta é uma ilustração direta e contável de por que as conexões persistentes se tornaram o padrão do HTTP/1.1: para uma página real com muitos objetos embutidos, evitar o estabelecimento repetido de conexões é uma economia substancial e mensurável.

## Equívocos Comuns e Armadilhas

- **"O HTTP trata ele mesmo da sua confiabilidade e ordenação."** O HTTP delega tudo isso inteiramente ao TCP; o próprio HTTP não tem lógica de retransmissão nem de sequenciamento própria. Ele simplesmente entrega uma requisição ao TCP e confia na garantia do TCP de que os bytes vão chegar, em ordem, do outro lado.
- **"Os cookies tornam o HTTP um protocolo com estado."** O próprio protocolo continua sem estado: nenhuma requisição HTTP é processada de forma diferente com base em memória, no nível do protocolo, de uma requisição anterior. Os cookies produzem a aparência de estado inteiramente por meio de um identificador que o cliente fornece de novo a cada vez, mais o estado que o servidor guarda e consulta ele mesmo; nada na própria lógica de tratamento de requisições do HTTP mudou.
- **"As conexões não persistentes são simplesmente um projeto inferior e obsoleto, sem vantagem alguma."** As conexões não persistentes eram o padrão original do HTTP/1.0 e são mais simples de raciocinar (cada conexão mapeia para exatamente um par de requisição e resposta, sem ambiguidade sobre reuso da conexão ou sobre quando fechá-la). O ganho de eficiência das conexões persistentes veio com uma complexidade genuinamente maior no gerenciamento do ciclo de vida da conexão, que o HTTP/1.1 precisou especificar com cuidado.
- **"Um código de status 200 significa que a página carregou corretamente para o usuário."** Significa que o *servidor* processou com sucesso a requisição e está retornando o recurso pedido. Falhas de renderização do lado do cliente, JavaScript quebrado ou um corpo de resposta malformado são preocupações inteiramente separadas, sobre as quais o código de status do HTTP não diz nada.

## Resumo

O HTTP é um protocolo de requisição e resposta sem estado, construído inteiramente sobre as garantias de conexão e de confiabilidade do TCP, que ele toma como garantidas em vez de reimplementá-las. A sua ausência de estado é uma escolha deliberada de simplicidade, contornada (e não abandonada no nível do protocolo) via cookies: um identificador atribuído pelo servidor que o cliente fornece de novo automaticamente em toda requisição, permitindo ao servidor manter o seu próprio estado de sessão indexado por esse identificador. As conexões persistentes do HTTP/1.1 mantêm uma conexão TCP aberta através de muitas requisições, evitando o custo real e mensurável de repetir o estabelecimento de conexão para cada objeto que uma página referencia. Uma requisição HTTP real tem uma linha de requisição, cabeçalhos e um corpo opcional; uma resposta real tem uma linha de status, cabeçalhos e um corpo. O HTTP é o protocolo concreto que o capstone desta disciplina inteira rastreia de ponta a ponta por toda camada inferior (resolução DNS, o three-way handshake do TCP, roteamento IP, enquadramento da camada de enlace), justamente porque ele fica bem no topo da pilha e é o protocolo que o clique ou o carregamento de página de fato de um usuário experimenta mais diretamente.

## Documentation Links

- [Kurose & Ross: Computer Networking: A Top-Down Approach (site oficial de apoio)](https://gaia.cs.umass.edu/kurose_ross/index.php): o tratamento do livro-texto padrão do HTTP, da ausência de estado, dos cookies e das conexões persistentes.
- [Stanford CS144: Lecture Schedule ("Application protocols")](https://www.scs.stanford.edu/10au-cs144/sched/): uma aula de um curso real dedicada aos protocolos da camada de aplicação, incluindo o HTTP, ensinada logo depois das fundações estruturais da rede.
