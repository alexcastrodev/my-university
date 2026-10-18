---
version: 1.0
updatedAt: 2026-08-05
title: "JShell: o REPL do Java"
summary: "Como o JShell permite avaliar expressões, declarar variáveis/métodos/classes, e obter feedback imediato sem um wrapper completo de classe/método main — a convenção de variável de resultado, referências antecipadas, os /commands essenciais, e como ele difere do lançamento de código-fonte em arquivo único."
---
## Objective

JShell é o REPL (Read-Evaluate-Print Loop) de linha de comando que acompanha o JDK desde o JDK 9 (JEP 222): ele permite digitar uma expressão, um statement, um método, ou até mesmo uma classe diretamente em um prompt e ver isso avaliado imediatamente, sem escrever uma classe com um método `main`, salvar um arquivo `.java`, ou compilar nada antes.

## Use Cases

- Experimentar um método de API desconhecido (`String.repeat()` remove espaços em branco? o que `List.of()` faz com um `null`?) em segundos, sem criar um projeto.
- Testar uma expressão regular ou um pipeline de stream contra dados de amostra antes de colar em código de verdade.
- Prototipar um pequeno algoritmo ou uma nova classe/interface interativamente, mantendo estado entre snippets enquanto ela toma forma.
- Ensinar ou aprender um recurso da linguagem: mostrando exatamente para o que uma expressão avalia, uma linha por vez.
- Checar rapidamente o comportamento de uma exceção checada, uma conversão numérica, ou um caso extremo sem a cerimônia de `try`/`catch` e um método `main`.

## Deep Dive

### Iniciando uma sessão e avaliando um statement solto

JShell é uma ferramenta de linha de comando: rode `jshell` e ele cai em um prompt interativo.

```
$ jshell
|  Welcome to JShell -- Version 25
|  For an introduction type: /help intro

jshell> System.out.println("This is a simple Java program.");
This is a simple Java program.
```

Sem `class`, sem `public static void main(String[] args)` — o JShell embrulha cada snippet em uma classe e método sintéticos por trás dos panos, então o mesmo código que roda no JShell continua sendo Java válido, só que sem a estrutura que o `javac` exigiria de outra forma.

### Variáveis e estado entre snippets

Declarar uma variável no prompt a adiciona como um campo `static` dessa classe sintética, e seu valor persiste entre snippets:

```
jshell> int count;
count ==> 0

jshell> count = 10;
count ==> 10

jshell> System.out.println("Reciprocal: " + 1.0 / count);
Reciprocal: 0.1
```

O JShell também aceita construções multilinha, exibindo `...>` até que o snippet esteja sintaticamente completo:

```
jshell> for (count = 0; count < 3; count++)
   ...> System.out.println(count);
0
1
2
```

### Avaliando uma expressão solta: as variáveis `$1`, `$2` ...

Uma expressão nem precisa de um statement ao redor — o JShell a avalia e armazena o resultado em uma variável numerada implícita:

```
jshell> 3.0 / 16.0
$1 ==> 0.1875

jshell> $1 * 2
$2 ==> 0.375
```

`$1`, `$2`, ... se comportam como qualquer outra variável: podem ser reatribuídas, impressas, ou usadas dentro de uma expressão posterior, o que torna encadear cálculos rápidos sem nomear tudo bem indolor.

### Métodos, classes e interfaces sem o boilerplate

Um método avulso vira um método `static` da classe sintética, chamável sem receiver:

```
jshell> double reciprocal(double d) { return 1 / d; }
|  created method reciprocal(double)

jshell> reciprocal(4.0)
$3 ==> 0.25
```

Classes e interfaces funcionam da mesma forma — declare uma, depois instancie e use imediatamente na mesma sessão:

```
jshell> class MyClass {
   ...>     double val;
   ...>     MyClass(double v) { val = v; }
   ...>     double reciprocal() { return 1 / val; }
   ...> }
|  created class MyClass

jshell> new MyClass(10.0).reciprocal()
$4 ==> 0.1
```

O JShell até suporta referências antecipadas: um método pode chamar outro método que ainda não foi definido, desde que ele exista quando o primeiro for de fato invocado.

### Pacotes auto-importados

O JShell inicia com um conjunto padrão de pacotes comuns já importados, então código que precisaria de um `import` explícito em um arquivo-fonte normal simplesmente funciona:

```
jshell> FileInputStream fin = new FileInputStream("myfile.txt");
```

`FileInputStream` resolve sem `import java.io.*;` porque o script de inicialização padrão pré-importa `java.io`, `java.math`, `java.net`, `java.nio.file`, `java.util`, `java.util.concurrent`, `java.util.function`, `java.util.prefs`, `java.util.regex`, e `java.util.stream`. Qualquer coisa fora dessa lista ainda precisa de um `import` explícito, e `/imports` lista o que está ativo no momento.

### Os comandos `/`

Tudo que não é código Java e começa com `/` é um comando do JShell, usado para inspecionar ou gerenciar a sessão em vez do código em si:

```
jshell> int start = 0;
start ==> 0

jshell> int end = 10;
end ==> 10

jshell> /vars
|    int start = 0
|    int end = 10

jshell> /methods
|    double reciprocal(double)

jshell> /list
   1 : int start = 0;
   2 : int end = 10;
   3 : double reciprocal(double d) { return 1 / d; }
```

`/edit` abre uma janela de editor para um snippet (`/edit`, `/edit 3`, ou `/edit start` para editar por número ou nome); `/save file` e `/open file` persistem uma sessão para um arquivo e a recarregam depois; `/exit` encerra a sessão. `/help` (ou `/?`) lista todo comando disponível.

## Trade-offs

- **Feedback rápido vs. nenhuma persistência por padrão** — nada sobrevive além do `/exit` a menos que seja explicitamente salvo com `/save`, então o JShell é melhor para exploração descartável, não para construir algo que precise durar além da sessão.
- **Conveniência esconde a estrutura** — a classe e o método sintéticos que fazem statements soltos funcionarem são invisíveis, o que é ótimo para velocidade mas pode obscurecer *por que* um `return` de nível superior ou um método avulso são legais aqui mas não compilariam assim em um `.java` real.
- **Auto-import e tratamento automático de exceção reduzem atrito, mas também reduzem fidelidade** — o JShell trata silenciosamente exceções checadas em snippets e pré-importa vários pacotes, então código que "simplesmente funciona" interativamente pode precisar de statements `try`/`catch` e `import` explícitos uma vez copiado para um arquivo-fonte real:

```
jshell> FileInputStream fin = new FileInputStream("myfile.txt"); // no try/catch, no import needed here
```

## Lab

Neste lab você recebe a classe `SnippetEvaluator` com dois métodos vazios e usa a API embutível do JShell (`jdk.jshell.JShell`) para executar código Java que só existe como `String` em tempo de execução. A ideia central é perceber que o `jshell` interativo é só uma casca: o motor por baixo é uma sessão de avaliação viva, que acumula estado entre snippets até ser fechada.

**O cenário**

Um programa Java recebe trechos de código como texto e precisa devolver o valor que cada um produz, sem compilar nada na mão. O `jdk.jshell` já vem no JDK, sem dependência extra e sem flags de módulo.

- `SnippetEvaluator.evaluate()`: recebe um snippet (`"2 + 2"`) e devolve o valor como `String` (`"4"`).
- `SnippetEvaluator.evaluateAll()`: recebe vários snippets e os executa juntos, de modo que uma variável declarada em um continue existindo no seguinte.

Dois detalhes do README valem antes de começar. `eval()` devolve uma `List<SnippetEvent>` porque um snippet pode afetar outros (redefinir um método atualiza quem o usava), e o evento do que você acabou de enviar é o último da lista. E uma declaração precisa do ponto e vírgula final (`"int x = 5;"`), enquanto uma expressão solta (`"2 + 2"`) não.

**O que você vai fazer, passo a passo**

1. **Avaliar um snippet (TODO-00).** Em `evaluate()`, crie um motor com `JShell.builder().build()` dentro de um try-with-resources (ele é `AutoCloseable`), chame `eval(expression)` e devolva o `value()` do evento, que é uma `String` ou `null` quando o snippet não produz valor (um statement, por exemplo).
2. **Compartilhar a sessão (TODO-01).** Em `evaluateAll()`, abra exatamente UMA instância de `JShell` para a chamada inteira, avalie cada expressão contra ela, na ordem, e feche no final. Devolva os valores na mesma ordem. É isso que faz `"int x = 5;"` seguido de `"x * 2"` funcionar: abrir uma instância por snippet jogaria o estado fora.

**Como saber que terminou**

`mvn test` fica todo verde. Você deve conseguir explicar por que `evaluateAll()` não pode simplesmente chamar `evaluate()` em loop e o que o fechamento do `JShell` faz com as variáveis declaradas.

**Pré-requisitos:** sintaxe básica de Java e try-with-resources.

**Como rodar:** clone o repositório, entre em `java-concepts/jshell-repl` e rode `mvn test` (ou, da raiz, `mvn -pl java-concepts/jshell-repl test`). Os dois métodos começam lançando `UnsupportedOperationException("Not implemented yet.")` com a dica no comentário `TODO-NN`, então os testes vermelhos são o seu checklist.

## Documentation Links

- [Introduction to JShell — Java SE 25](https://docs.oracle.com/en/java/javase/25/jshell/introduction-jshell.html) — doc
- [The jshell Command — Java SE 25 Tool Specifications](https://docs.oracle.com/en/java/javase/25/docs/specs/man/jshell.html) — doc
