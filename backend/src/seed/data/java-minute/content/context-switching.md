---
version: 1.0
updatedAt: 2026-07-20
---
## Pergunta

# O que é context switching?

## Resposta Curta

Context switching é a troca de contexto que o sistema operacional faz entre threads em um mesmo núcleo de CPU. É algo que, em geral, devemos **evitar**: está diretamente relacionado à concorrência e, quando acontece com frequência, prejudica a performance da aplicação.

## O que é

Uma thread roda em um núcleo (core) da CPU. Enquanto está em execução, ela carrega o que chamamos de **contexto**: os dados que está manipulando, o código sendo executado, o conteúdo de cache e os registradores da CPU.

Quando o sistema operacional decide que outra thread precisa rodar naquele mesmo núcleo, ele precisa **pausar a thread atual** para dar lugar à próxima. Isso significa remover o contexto da thread pausada do núcleo e, mais tarde, quando for a vez dela rodar de novo, devolver esse contexto para o núcleo — como se fosse "desempacotar" tudo de novo.

## O Processo

1. O SO decide interromper a thread em execução (ex: fim de fatia de tempo, ou a thread ficou bloqueada esperando algo).
2. O contexto da thread (registradores, dados, estado) é salvo fora do núcleo.
3. O núcleo fica livre e o SO carrega o contexto de outra thread pronta para rodar.
4. Essa nova thread executa.
5. Quando chega a vez da thread original voltar a rodar, seu contexto é recarregado no núcleo — praticamente do zero.

## Impacto na Performance

Cada troca de contexto leva, em média, cerca de **100 microssegundos**. Pode parecer pouco, mas para os padrões de uma CPU é um tempo considerado **alto**: nesse intervalo, o núcleo não está fazendo trabalho útil para nenhuma das duas threads, só salvando e restaurando estado.

Em aplicações com muitas threads concorrentes disputando poucos núcleos, esse custo se repete constantemente e pode consumir uma fatia relevante do tempo de CPU — tempo que deveria ir para processamento real, não para "trocar de roupa" entre threads.

## Exemplo Prático

O cenário mais comum: uma thread faz uma chamada de rede (por exemplo, uma requisição HTTP para outro serviço) e essa chamada é **bloqueante** — a thread fica parada esperando a resposta chegar.

Enquanto essa thread espera, ela não está fazendo nada útil, mas ainda ocupa um núcleo. Para não desperdiçar esse núcleo, o SO frequentemente faz context switching: tira essa thread bloqueada dali e coloca outra no lugar. Quando a resposta da rede finalmente chega, é preciso trazer a thread de volta — outro context switching.

## Solução e Conclusão

A recomendação prática é usar **virtual threads**. Como virtual threads não ocupam uma kernel thread de forma exclusiva enquanto esperam uma operação bloqueante (como I/O de rede), o bloqueio de uma virtual thread não trava a kernel thread por trás dela.

Isso evita boa parte do context switching desnecessário e, como consequência prática, reduz bugs relacionados à concorrência que costumam surgir da complexidade de gerenciar muitas threads tradicionais competindo por poucos núcleos.

## Referências

- [Minuto Java: Context Switching](https://www.youtube.com/shorts/m7HvmcRAvac) — vídeo
- [JEP 444: Virtual Threads](https://openjdk.org/jeps/444) — doc
- [java.lang.Thread — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/Thread.html) — doc
