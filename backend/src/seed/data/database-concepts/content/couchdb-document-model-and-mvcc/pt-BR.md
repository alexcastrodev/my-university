---
version: 1.0
updatedAt: 2026-08-21
title: "O Modelo de Documento: Acesso Apenas via HTTP e MVCC Baseado em Revisão"
summary: O CouchDB expõe documentos exclusivamente sobre HTTP/REST, sem protocolo de fio, sem driver binário, toda operação tem a forma de uma requisição curl, e substitui locking por MVCC baseado em revisão, um _rev desatualizado recebe 409 em um único nó, mas entre réplicas ambas as escritas concorrentes têm sucesso e o conflito resultante é detectado e mesclado pela aplicação, nunca pelo banco de dados.
---
## Objective

Entender as duas decisões que tornam o modelo de documento do CouchDB genuinamente diferente de um armazenamento de documento como o MongoDB: toda interação acontece sobre HTTP/REST puro (não há protocolo de fio separado, nenhum driver binário, "todas as chamadas ao CouchDB acontecem através de sua interface REST") e todo documento carrega um id de revisão (`_rev`) que o CouchDB usa para controle de concorrência multiversão (MVCC), em vez de locks. O CouchDB nunca bloqueia um escritor esperando outro escritor; ou rejeita uma escrita completamente porque o `_rev` de quem chamou está desatualizado, ou, no caso distribuído/replicado, deixa ambas as escritas terem sucesso e deixa o conflito resultante para a aplicação encontrar e resolver em uma leitura posterior.

## Use Cases

- Conversar com o CouchDB de qualquer ambiente que consiga fazer uma requisição HTTP (um script shell com `curl`, um `fetch` de navegador, o health check de um load balancer), sem driver, sem biblioteca de cliente, e sem protocolo binário para instalar ou combinar versão.
- Escrever a sequência correta de atualização para qualquer documento: `GET` o documento (para obter o `_id` e `_rev` atuais), modificar o corpo JSON *inteiro*, então `PUT` de volta com aquele `_rev`; nunca um `PUT` cego ou uma atualização parcial de campo.
- Explicar por que um `PUT` repetido ou em corrida volta com `409 Conflict` e `{"error":"conflict","reason":"Document update conflict."}`, em vez de silenciosamente sobrescrever a mudança de outra pessoa ou ficar pendurado até um lock liberar.
- Desenhar um sistema multi-master ou offline-first (por exemplo, um cliente PouchDB sincronizando com um servidor CouchDB), onde você precisa assumir que replicação pode e vai produzir documentos com mais de uma revisão viva, e construir o caminho de leitura para checar e resolver `_conflicts`, em vez de confiar que "o documento" é inequívoco.
- Diagnosticar um relatório de bug do tipo "atualizei o documento e minha mudança não pegou": as duas explicações vivas sob o modelo do CouchDB são uma rejeição por `_rev` desatualizado que o cliente engoliu, ou um conflito de replicação onde uma revisão *diferente* daquela que o usuário escreveu venceu o desempate determinístico e é o que leituras subsequentes retornam.

## Deep Dive

### JSON sobre HTTP, e nada mais

O enquadramento do livro para o capítulo inteiro: "o CouchDB é orientado a documento, usando JSON como sua linguagem de armazenamento e comunicação. Todas as chamadas ao CouchDB acontecem através de sua interface REST." Não existe um equivalente do protocolo de fio BSON do MongoDB, ou um driver que fala um protocolo binário por baixo de uma API mais amigável: "todas as bibliotecas e drivers para o CouchDB acabam enviando requisições REST por baixo dos panos, então faz sentido começar entendendo como elas funcionam." Toda operação no capítulo é uma chamada `curl`:

```
$ curl "${COUCH_ROOT_URL}/music/2ac58771c197f70461056f7c7e0001f9"
{
  "_id": "2ac58771c197f70461056f7c7e0001f9",
  "_rev": "8-e1b7281f6adcd82910c6473be2d4e2ec",
  "name": "The Beatles",
  "albums": [ ... ]
}
```

`GET` é sempre seguro: "o CouchDB não vai fazer nenhuma mudança em documentos como resultado de um GET." Criar um documento novo é `POST` para a URL do banco de dados (um header `Content-Type: application/json` é obrigatório, ou o CouchDB recusa a requisição); o corpo da resposta `201 Created` entrega de volta o `_id` atribuído pelo servidor e o primeiro `_rev`:

```
$ curl -i -XPOST "${COUCH_ROOT_URL}/music/" \
 -H "Content-Type: application/json" \
 -d '{ "name": "Wings" }'
...
{ "ok": true, "id": "2ac58771c197f70461056f7c7e002eda", "rev": "1-2fe1dd1911153eb9df8460747dfe75a0" }
```

Isso ainda se sustenta inalterado no CouchDB atual (3.5.x, verificado contra a documentação do Apache CouchDB): a API HTTP não é uma camada de conveniência sobre algum protocolo nativo mais rápido, ela *é* o protocolo. Esse é o ponto direto de contraste com o modelo de documento do MongoDB (veja `mongodb-document-model-and-collections`): documentos do MongoDB viajam sobre um protocolo de fio baseado em BSON, que drivers implementam nativamente por performance, e a API de shell/driver permite corrigir um único campo no lugar com `$set`. O CouchDB não tem nenhum operador de atualização no lugar: "diferente do MongoDB, no qual você modifica documentos no lugar, com o CouchDB você sempre sobrescreve o documento inteiro para fazer qualquer mudança." A UI web do Fauxton *parece* edição no nível de campo, mas "por trás dos panos ela estava regravando o documento inteiro quando você clicava em Save Changes." Toda atualização é ler-o-documento-inteiro, modificar, escrever-o-documento-inteiro de volta.

### `_rev` e MVCC: sem locks, sem transações

`_id` e `_rev` são campos reservados em todo documento. `_id` é atribuído uma vez (pelo cliente ou pelo CouchDB) e nunca muda. `_rev` é atribuído em toda escrita e toma a forma de um número de revisão inteiro, um traço, e um hash, por exemplo `8-e1b7281f6adcd82910c6473be2d4e2ec`, onde "o inteiro no começo denota a revisão numérica." Para atualizar ou deletar um documento você precisa fornecer tanto o `_id` quanto um `_rev` que combine com o estado atual do documento, ou o CouchDB rejeita a operação.

O livro afirma a filosofia subjacente diretamente: "não há transações ou locking no CouchDB... todas as operações são por ordem de chegada. Ao exigir um `_rev` correspondente, o CouchDB garante que o documento que você acha que está modificando não foi alterado pelas suas costas enquanto você não estava olhando." A documentação atual do CouchDB enquadra o mesmo mecanismo como uma troca deliberada pela ausência de estado do HTTP: como "o protocolo HTTP que o CouchDB usa não tem estado", MVCC permite ao CouchDB "lidar com muito mais conexões concorrentes" do que um protocolo que mantém locks entre requisições, e leitores *nunca* são bloqueados por escritores: "qualquer número de clientes pode estar lendo documentos sem ser trancado de fora ou interrompido por atualizações concorrentes, mesmo no mesmo documento." Concretamente, em um único nó, um segundo `PUT` reutilizando um `_rev` já substituído recebe:

```
$ curl -i -XPUT ".../music/2ac58771c197f70461056f7c7e002eda" ...
HTTP/1.1 409 Conflict
{"error":"conflict","reason":"Document update conflict."}
```

Esse caso de nó único é uma *rejeição*, não um lock: a requisição do segundo escritor falha rápido, em vez de entrar na fila atrás da primeira. `DELETE` também não é isento: ainda exige um `_rev` correspondente (via `If-Match` ou um parâmetro de query `?rev=`), retorna uma *nova* revisão mesmo com o documento "sumido", e, segundo o livro, na verdade não apaga nada do disco: "o documento não foi realmente removido do disco, mas sim um novo documento vazio foi anexado, sinalizando o documento como deletado."

### A parte distintiva: conflitos que não são rejeitados, são detectados

O comportamento de 409-em-`_rev`-desatualizado acima é controle de concorrência otimista, e vários bancos de dados têm algo parecido. O que é genuinamente distintivo do CouchDB, e a razão pela qual o livro destaca isso como sua própria filosofia de design, em vez de um recurso genérico de "armazenamento de documento", é o que acontece uma vez que você replica. O exemplo canônico do CouchDB (da documentação oficial, não do livro, mas descrevendo o mesmo mecanismo `_rev` que o livro introduz): Alice edita o endereço de email de um contato em seu desktop e, antes de sincronizar, edita o número de telefone do mesmo contato em seu laptop. Ambas as edições começam a partir do mesmo `_rev` e ambas têm sucesso *localmente*: não há um coordenador para bloquear qualquer uma das escritas, porque os dois nós ainda não estão conversando entre si. Quando os dois bancos de dados replicam, o CouchDB não escolhe um vencedor e descarta o perdedor completamente: **ambas as revisões são mantidas**, como dois ramos da árvore de revisão do mesmo documento, em ambos os nós. Esse é o comportamento de "ambas as escritas têm sucesso e o conflito aparece depois": o CouchDB nunca bloqueou nenhuma das edições, e o caminho de escrita nunca falhou; o conflito é descoberto na leitura.

Para tornar os resultados determinísticos sem que nenhum nó precise conversar com nenhum outro nó, o CouchDB roda um algoritmo fixo, independente de ordem, para escolher uma revisão como o "vencedor" atual: toda réplica, computando sobre o mesmo conjunto de revisões, converge para a mesma escolha sem um voto ou um coordenador. Mas a revisão perdedora não é deletada; ela permanece na árvore de revisão como uma folha viva. Uma aplicação pode descobri-la explicitamente:

- `GET /db/docid?conflicts=true` retorna a revisão vencedora mais um array `_conflicts` nomeando os outros ids de revisão vivos.
- `GET /db/docid?open_revs=all` retorna toda revisão folha, incluindo as sinalizadas como `_deleted`.
- Uma query Mango com `{"selector": {"_conflicts": {"$exists": true}}}` encontra todo documento em conflito no banco de dados.

Resolver um é inteiramente trabalho da aplicação: buscar cada revisão em conflito por id, aplicar qualquer lógica de merge que faça sentido para o dado (manter a edição de telefone *e* a edição de email, no caso de Alice), então submeter uma única chamada `POST /_bulk_docs` que escreve o documento mesclado e marca as revisões perdedoras como `"_deleted": true`, para que parem de aparecer como conflitos vivos. Nada no CouchDB vai fazer esse merge por você; ele garante apenas que nenhuma edição é silenciosamente perdida e que toda réplica concorda sobre qual única revisão é "atual" até que você diga o contrário.

### Book vs. today

- **O mecanismo central permanece inalterado.** Verificado contra a documentação atual do Apache CouchDB (3.5.x): o formato de `_rev` (`N-hash`), a rejeição de nó único de 409-em-`_rev`-desatualizado, o comportamento de "ambas as revisões sobrevivem à replicação", o algoritmo determinístico de seleção de vencedor, e a API de resolução de conflito `?conflicts=true` / `?open_revs=all` / `_bulk_docs` descrita acima permanecem exatamente como o livro (2018, descrevendo o CouchDB 2.0) os apresenta. Os exemplos `curl` do livro mostram `"version": "2.0.0"` na resposta de boas-vindas; uma instância atual reporta `3.5.x`, mas toda forma de requisição no capítulo ainda funciona sem modificação.
- **Acesso apenas via HTTP não mudou e nunca iria mudar.** O CouchDB não adicionou um protocolo de fio binário nem um protocolo de driver nativo nos anos desde então; REST sobre HTTP continua sendo a *superfície inteira* da API, por design, não como uma limitação legada esperando ser substituída.
- **Ferramental operacional para conflitos cresceu.** O CouchDB 3.5.0 (maio de 2025) adicionou um plugin scanner embutido de "buscador de conflitos", uma forma no lado do servidor, em todo o cluster, de expor documentos com conflitos não resolvidos, complementando a abordagem `?conflicts=true` / query Mango sempre disponível por documento, que o livro efetivamente ensina você a construir sozinho.
- **O PouchDB vale a pena conhecer como a metade do lado do cliente desta história.** O livro o sinaliza em um box como uma ferramenta emergente e explicitamente se recusa a cobri-lo. Em 2025, ele continua sendo um banco de dados JavaScript ativamente usado, que roda no navegador ou em dispositivo móvel e replica bidirecionalmente com o CouchDB: a forma padrão de fazer aplicações web/mobile offline-first conversarem com um backend CouchDB. Criticamente, o PouchDB herda exatamente este modelo de conflito, em vez de escondê-lo: uma aplicação construída sobre o PouchDB ainda precisa detectar e resolver `_conflicts` depois da sincronização, só que no cliente, em vez de (ou além de) no servidor.

## Trade-offs

- **Nunca bloquear é uma troca de disponibilidade, não um almoço grátis.** Como nenhum nó espera por nenhum outro nó antes de aceitar uma escrita, o CouchDB (e clientes PouchDB sincronizando com ele) continuam aceitando escritas através de partições e períodos offline que travariam um sistema baseado em lock. A conta chega na reconexão: a aplicação, não o banco de dados, precisa saber como mesclar a edição de email e a edição de telefone de Alice, e todo lugar onde um documento pode ser editado concorrentemente em mais de um nó precisa dessa lógica de merge desenhada antecipadamente; "eventualmente consistente" aqui significa eventualmente *correto*, e só se alguém escreveu o código de resolução.
- **Um vencedor determinístico previne divergência, não o risco de perda de dado para o usuário.** Toda réplica concordando na mesma revisão "atual" significa que leituras são consistentes através do cluster sem coordenação, mas o vencedor é escolhido por um algoritmo fixo sobre hashes de revisão, não por "qual edição é mais importante" ou "qual edição é mais nova." Uma correção trivial de erro de digitação pode vencer sobre uma edição substantiva no status de vencedor; se a aplicação nunca checa `_conflicts`, usuários silenciosamente veem a versão "errada" (escolhida arbitrariamente), sem erro levantado em lugar nenhum.
- **Sobrescrita de documento inteiro torna a detecção de conflito simples e toda escrita mais pesada.** Comparar uma string `_rev` é tudo o que o CouchDB precisa para aceitar ou rejeitar uma escrita, e não há lógica de merge no nível de campo dentro do banco de dados para errar. O custo é que mudar um campo significa transmitir e reescrever o documento inteiro toda vez: sem atualização parcial no estilo `$set`, e um cliente ingênuo que não faz `GET` imediatamente antes do `PUT` vai receber 409 de forma confiável sob qualquer concorrência real.
- **Acesso apenas via HTTP compra interoperabilidade universal e abre mão de eficiência no nível do fio.** Qualquer linguagem com um cliente HTTP consegue conversar com o CouchDB sem dependência de driver, e toda requisição é trivialmente reproduzível com `curl` para depuração: genuinamente valioso para a história de implantação "roda em um telefone, um laptop, e um data center" que o livro enfatiza. O custo é o overhead por requisição do HTTP (headers, configuração de conexão, (de)serialização JSON), comparado a um protocolo binário feito sob medida para os padrões de acesso de um banco de dados, que é parte de por que o CouchDB não é o primeiro recurso para cargas de trabalho OLTP de alto throughput.
- **Essa é uma aposta diferente da do MongoDB, não estritamente melhor ou pior.** O modelo de documento do MongoDB (veja o conceito irmão) otimiza para atualizações parciais no lugar e um protocolo de fio no nível do driver, e empurra o tratamento de conflitos para "o locking do motor de armazenamento tornou isso seguro" para um primário único; não tem nenhum mecanismo de `_rev`/exposição de conflito no nível de documento de forma alguma. O CouchDB otimiza para sobreviver a partição e operação offline entre muitos escritores independentes, e empurra o tratamento de conflito explicitamente para o código da aplicação como um passo de primeira classe, inevitável. Escolha com base em se "muitos escritores desconectados, ocasionalmente reconciliados" ou "um primário autoritativo único, sempre alcançável" descreve seu sistema.

## Documentation Links

- [Luc Perkins, Eric Redmond, and Jim R. Wilson, "Seven Databases in Seven Weeks", 2nd Edition (Pragmatic Bookshelf, 2018), Chapter 5, "CouchDB", Introduction and Day 1: "CRUD, Fauxton, and cURL Redux"](https://pragprog.com/titles/pwrdata2/seven-databases-in-seven-weeks-second-edition/) - doc
- [Apache CouchDB Documentation, Technical Overview](https://docs.couchdb.org/en/stable/intro/overview.html) - doc
- [Apache CouchDB Documentation, Replication and Conflict Model](https://docs.couchdb.org/en/stable/replication/conflicts.html) - doc
- [Apache CouchDB Documentation, HTTP Document API (revisions, `_rev`, conflict responses)](https://docs.couchdb.org/en/stable/api/document/common.html) - doc
- [Apache CouchDB Documentation, Release Notes (What's New in 3.5)](https://docs.couchdb.org/en/stable/whatsnew/3.5.html) - doc
- [PouchDB Documentation, Conflicts Guide](https://pouchdb.com/guides/conflicts.html) - doc
