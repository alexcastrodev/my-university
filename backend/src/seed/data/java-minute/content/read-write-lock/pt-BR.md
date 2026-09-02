---
version: 1.0
updatedAt: 2026-09-02
question: O que é um ReadWriteLock?
---
## Question

# O que é um ReadWriteLock?

## Short Answer

Um lock que permite leituras paralelas e bloqueia as escritas.

## Less Short Answer

Locks são usados para prevenir condições de corrida. Uma condição de corrida ocorre quando duas threads estão escrevendo e lendo o mesmo campo: será que a thread B vai enxergar o valor escrito pela thread A? A sincronização garante isso bloqueando tudo.

## Dois Locks em Um

O `ReadWriteLock` funciona com dois locks: um para as operações de leitura, e outro para as operações de escrita. O lock de escrita é exclusivo — nenhum outro lock pode ser obtido enquanto ele estiver ativo. Já o lock de leitura não é assim: você pode ter qualquer número de locks de leitura ativos ao mesmo tempo.

## One Last Word

Claro, isso só é uma otimização se o seu número de operações de escrita for bem menor que o número de operações de leitura.

## References

- [Java Coding Tip #162: What Is a ReadWriteLock?](https://www.youtube.com/shorts/ubmAvn-8QTM) — video
- [ReadWriteLock — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/locks/ReadWriteLock.html) — doc
- [ReentrantReadWriteLock — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/locks/ReentrantReadWriteLock.html) — doc
