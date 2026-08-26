---
version: 1.0
updatedAt: 2026-07-20
question: O que é troca de contexto (context switching)?
---
## Question

# O que é troca de contexto (context switching)?

## Short Answer

Troca de contexto é quando o sistema operacional substitui o contexto de uma thread pelo de outra no mesmo núcleo de CPU. É algo que, em geral, deve ser **evitado**: está diretamente ligado à concorrência e, quando acontece com frequência, prejudica a performance da aplicação.

## What It Is

Uma thread executa em um núcleo de CPU. Enquanto está em execução, ela carrega o que chamamos de seu **contexto**: os dados com os quais está trabalhando, o código sendo executado, o conteúdo do cache e os registradores da CPU.

Quando o sistema operacional decide que outra thread precisa rodar naquele mesmo núcleo, ele precisa **pausar a thread atual** para abrir espaço para a próxima. Isso significa remover o contexto da thread pausada do núcleo e, mais tarde, quando chegar a vez dessa thread rodar de novo, carregar esse contexto de volta no núcleo — como se estivesse "desempacotando" tudo outra vez.

## The Process

1. O sistema operacional decide interromper a thread em execução (por exemplo, seu fatia de tempo terminou, ou ela ficou bloqueada esperando por algo).
2. O contexto da thread (registradores, dados, estado) é salvo, saindo do núcleo.
3. O núcleo fica livre, e o sistema operacional carrega o contexto de outra thread pronta pra rodar.
4. Essa nova thread executa.
5. Quando chega a hora da thread original rodar de novo, seu contexto é recarregado no núcleo — praticamente do zero.

## Performance Impact

Cada troca de contexto leva, em média, cerca de **100 microssegundos**. Isso pode parecer pouco, mas para os padrões de uma CPU é considerado um tempo **longo**: durante essa janela, o núcleo não está fazendo trabalho útil para nenhuma das duas threads — está só salvando e restaurando estado.

Em aplicações com muitas threads concorrentes disputando poucos núcleos, esse custo se repete constantemente e pode consumir uma fatia relevante do tempo de CPU — tempo que deveria ir para processamento de verdade, não para "trocar de roupa" entre threads.

## Practical Example

O cenário mais comum: uma thread faz uma chamada de rede (por exemplo, uma requisição HTTP pra outro serviço) e essa chamada é **bloqueante** — a thread fica parada esperando a resposta chegar.

Enquanto essa thread espera, ela não está fazendo nada útil, mas continua ocupando um núcleo. Para não desperdiçar esse núcleo, o sistema operacional frequentemente faz uma troca de contexto: tira a thread bloqueada e coloca outra no lugar. Quando a resposta da rede finalmente chega, a thread original precisa ser trazida de volta — outra troca de contexto.

## Solution and Conclusion

A recomendação prática é usar **virtual threads**. Como as virtual threads não ocupam exclusivamente uma kernel thread enquanto esperam uma operação bloqueante (como I/O de rede), bloquear uma virtual thread não trava a kernel thread por trás dela.

Isso evita boa parte das trocas de contexto desnecessárias e, como consequência prática, reduz bugs relacionados a concorrência que costumam surgir da complexidade de gerenciar muitas threads tradicionais disputando poucos núcleos.

## References

- [Java Coding Tip #376: Context Switching](https://www.youtube.com/shorts/m7HvmcRAvac) — video
- [JEP 444: Virtual Threads](https://openjdk.org/jeps/444) — doc
- [java.lang.Thread — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/Thread.html) — doc
