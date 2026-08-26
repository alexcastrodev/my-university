---
version: 1.0
updatedAt: 2026-08-05
question: O que é o JLink?
---
## Question

# O que é o JLink?

## Short Answer

`jlink` é uma ferramenta padrão do JDK que constrói uma imagem de runtime customizada, contendo apenas os módulos que sua aplicação realmente precisa.

## What It Is

O JDK oferece duas ferramentas que trabalham juntas para empacotamento e distribuição:

- `jlink` cria uma imagem de runtime enxuta.
- `jpackage` embrulha essa imagem em um instalador ou pacote nativo.

`jlink` funciona com aplicações modulares. Ele parte do módulo da sua aplicação, resolve os módulos que ela precisa, e então monta uma imagem de runtime que inclui apenas esse grafo de módulos. Isso significa que você leva os módulos do JDK que realmente usa, em vez de embarcar o JDK inteiro.

Na prática, essa imagem já contém um launcher `java` executável e os módulos de plataforma dos quais sua aplicação depende, então a máquina de destino não precisa de uma instalação separada do JDK completo.

Um detalhe importante: os módulos são incluídos no nível do módulo, não classe por classe. Então, se você depende de um módulo grande só pra usar uma classe, pode acabar levando mais do que esperava. `jlink` é ótimo pra enxugar o JDK, mas não consegue enxugar dentro de um módulo.

Se a sua aplicação não é modular, `jlink` não é a ferramenta certa. Ele precisa de módulos nomeados para conseguir resolver o grafo de dependências antes de construir a imagem.

## Practical Example

```bash
jlink \
  --module-path $JAVA_HOME/jmods:mods \
  --add-modules com.myapp \
  --output myapp-runtime
```

Esse comando diz ao `jlink` onde encontrar os módulos de plataforma (`$JAVA_HOME/jmods`) e os módulos da sua aplicação (`mods`), qual módulo raiz incluir, e onde escrever a imagem de runtime customizada.

A partir daí, o `jlink` percorre o grafo de módulos:

- começa em `com.myapp`;
- adiciona toda dependência `requires` transitiva;
- mantém apenas os módulos do JDK que são realmente necessários;
- escreve a imagem final em `myapp-runtime`.

Se você usar o `jpackage` depois, pode transformar essa imagem num instalador específico da plataforma, em vez de distribuir um diretório cru.

## Solution and Conclusion

Use `jlink` quando quiser distribuir uma aplicação modular com um runtime menor e autocontido. Depois use `jpackage` se quiser transformar esse runtime num instalador para Windows, macOS ou Linux.

Pense no pipeline assim:

1. compile o seu módulo;
2. empacote como um JAR modular;
3. gere um runtime customizado com `jlink`;
4. opcionalmente, embrulhe esse runtime com `jpackage`.

Então, resumindo: `jlink` enxuga o runtime, `jpackage` entrega.

## References

- [Java Coding Tip #383: JLink](https://youtube.com/shorts/bJ3GDdTmRJc?is=FoMccFwLU_1L-t8D) — video
- [jlink — Java SE 25 Tool Reference](https://docs.oracle.com/en/java/javase/25/docs/specs/man/jlink.html) — doc
- [jpackage — Java SE 25 Tool Reference](https://docs.oracle.com/en/java/javase/25/docs/specs/man/jpackage.html) — doc
