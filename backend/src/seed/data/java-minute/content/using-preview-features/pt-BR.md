---
version: 1.0
updatedAt: 2026-08-07
question: Como usar preview features?
---
## Question

# Como usar preview features?

## Short Answer

Existem duas opções pra isso: uma pro compilador e outra pra JVM.

## What It Is

Você precisa ativar preview features em dois níveis.

**Nível de compilador.** Adicione `--enable-preview` e depois especifique um destes:

- `--source`, seguido da versão da fonte que você está usando — qualquer versão entre 8 e a versão do JDK que você está usando; ou
- `--target`, seguido da versão do bytecode que você quer gerar — novamente, entre 8 e a versão do JDK que você está usando.

**Nível de runtime.** Adicione a mesma opção `--enable-preview` ao comando `java`, para que a JVM saiba que você quer rodar código que usa preview features.

Então você não consegue usar preview features por acidente. Você precisa dizer ao compilador que quer ativá-las, e em tempo de execução precisa dizer à JVM que quer executá-las.

## Practical Example

```bash
javac --enable-preview --source 25 Main.java
java --enable-preview Main
```

## Solution and Conclusion

Esse mecanismo de preview features é útil porque você pode ativar preview features sob demanda, sem baixar uma build separada do JDK. Isso facilita experimentá-las e dar feedback nas listas de discussão do OpenJDK se você achar que falta algo ou que algo está errado — o que você definitivamente deveria fazer.

## References

- [Java Coding Tip #384: Using Preview Features](https://www.youtube.com/watch?v=2gmWx0-zqkk) — video
- [javac — Java SE 25 Tool Reference (--enable-preview)](https://docs.oracle.com/en/java/javase/25/docs/specs/man/javac.html) — doc
- [java — Java SE 25 Tool Reference (--enable-preview)](https://docs.oracle.com/en/java/javase/25/docs/specs/man/java.html) — doc
