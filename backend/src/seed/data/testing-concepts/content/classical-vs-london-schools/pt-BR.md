---
version: 1.0
updatedAt: 2026-08-13
title: "Escolas Clássica vs. London de Teste Unitário"
summary: "Duas definições genuinamente diferentes de \"isolamento\" em teste: mockar todo colaborador (London) versus mockar só dependências compartilhadas/voláteis (clássica), e por que discordam sobre o que é uma unidade."
---
## Objective

Entender as escolas clássica (Detroit) e London (mockista) de teste unitário: duas definições genuinamente diferentes de "isolamento" que levam a respostas opostas sobre o que é uma unidade e quais dependências devem ser substituídas por test doubles.

## Use Cases

- Decidir se os colaboradores reais de uma classe devem ser usados como estão em um teste, ou substituídos por mocks, quando a própria classe não tem dependência de banco de dados/rede.
- Explicar por que dois desenvolvedores experientes podem discordar fortemente sobre se um determinado teste é "de verdade" um teste unitário.
- Reconhecer uma dependência da data/hora atual ou de um gerador de números aleatórios como algo que vale a pena isolar, mesmo não sendo uma chamada a banco de dados.

## Deep Dive

### Mesma definição de três palavras, leitura diferente de "isolado"

Toda definição de teste unitário concorda em três atributos: ele verifica um pequeno pedaço de código, roda rápido e faz isso de maneira *isolada*. Os dois primeiros são incontroversos. O terceiro é onde as escolas clássica e London genuinamente discordam, e essa única discordância é a raiz de tudo o mais que as diferencia.

### A visão London: isolar o sistema sob teste de seus colaboradores

A escola London lê isolamento como: substituir cada uma das dependências de uma classe (tudo, exceto valores imutáveis) por um test double, de modo que uma falha de teste só possa significar uma coisa: o próprio sistema sob teste está quebrado, nunca um de seus vizinhos. Isso também permite testar uma classe sem precisar construir todo o seu grafo de objetos, o que importa quando uma base de código tem classes interconectadas o suficiente para que instanciar a versão "real" de tudo se torne impraticável.

### A visão clássica: isolar os testes entre si, não a classe de seus colaboradores

A escola clássica lê isolamento de forma diferente: são os *testes* que precisam rodar isolados uns dos outros (para que a ordem e o paralelismo dos testes nunca afetem os resultados), não a classe sob teste isolada de seus colaboradores reais. Sob essa visão, usar as dependências reais de uma classe é aceitável, desde que essas dependências sejam rápidas, determinísticas e não vazem estado entre execuções de teste. Uma unidade, nessa escola, não precisa significar uma classe; pode ser uma classe ou um pequeno agrupamento de classes colaborando, testadas em conjunto.

```
                  Isolamento de...          Uma unidade é...              Usa test doubles para...
Escola London     Unidades (o SUT)          Uma única classe               Tudo, exceto dependências imutáveis
Escola clássica   Testes (entre si)         Uma classe ou um agrupamento   Apenas dependências compartilhadas
```

### O que realmente precisa de um test double: dependências compartilhadas e voláteis

A escola clássica não evita test doubles, apenas restringe *quais* dependências precisam de um, usando duas propriedades:

- **Dependência compartilhada**: algo cujo estado um teste pode deixar para trás e outro teste acabar vendo por acidente (um banco de dados, o sistema de arquivos, qualquer recurso fora de processo). Essa é a razão real para isolá-la: não porque "é externa", mas porque "pode fazer os testes interferirem uns nos outros".
- **Dependência volátil**: algo não determinístico (um gerador de números aleatórios, um relógio/provedor de data e hora atual), porque um teste construído sobre um valor que muda a cada execução não consegue afirmar nada de forma confiável.

Uma dependência de banco de dados costuma ser compartilhada *e* volátil ao mesmo tempo. O sistema de arquivos é compartilhado (testes que o usam podem colidir), mas não volátil (se comporta da mesma forma a cada execução). Um gerador de números aleatórios é volátil, mas, dada uma instância nova por teste, não necessariamente compartilhado. Valores imutáveis e dentro do processo (como um value object `Product`) não satisfazem nenhuma das duas propriedades e não precisam de um double em nenhuma das duas escolas; esse é também o único ponto de sobreposição entre elas: até a escola London permite usar objetos reais como estão quando são imutáveis.

## Trade-offs

- **O isolamento estilo London dá um sinal de falha inequívoco, ao custo de testar menos integração real**: mockar todo colaborador faz com que um teste vermelho só possa significar que o SUT está quebrado, mas esse mesmo isolamento significa que o teste nunca verifica se o SUT de fato coopera corretamente com suas dependências reais.
- **Testes estilo clássico exercitam mais código real, ao custo de um sinal de falha mais lento e às vezes menos preciso**: usar colaboradores reais dá mais confiança de que o agrupamento inteiro de classes de fato funciona junto, mas uma falha pode se originar em qualquer uma delas, não apenas na que nominalmente está sendo testada.
- **Nenhuma das escolas trata toda dependência da mesma forma**: as duas isentam valores imutáveis da necessidade de um double; a discordância real é sobre dependências *mutáveis, dentro do processo*, onde a London as substitui e a clássica não, e não sobre se uma chamada a banco de dados pertence a um teste unitário (ambas concordam que não).
- **A preferência declarada do próprio livro é pela abordagem clássica**: não porque a London esteja errada, mas porque isolar demais com mocks (veja o pilar de "resistência à refatoração" nos quatro pilares) tende a acoplar os testes a detalhes de implementação mais do que o estilo clássico, o que é a razão mais profunda pela qual essa escolha importa além do gosto pessoal.

## Documentation Links

- Vladimir Khorikov, *Unit Testing Principles, Practices, and Patterns* (Manning, 2020), Capítulo 2 "What Is a Unit Test?", pp. 20-36 (book)
- Kent Beck, *Test-Driven Development: By Example* (Addison-Wesley, 2002), referência canônica da escola clássica (book)
- Steve Freeman & Nat Pryce, *Growing Object-Oriented Software, Guided by Tests* (Addison-Wesley, 2009), referência canônica da escola London (book)
