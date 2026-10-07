---
version: 1.0
updatedAt: 2026-09-28
question: Em que o yield return é compilado?
---
## Question

# Em que o `yield return` é compilado?

## Short Answer

Em uma **classe de máquina de estados**. O compilador reescreve o seu método em um tipo oculto que implementa `IEnumerable<T>` e `IEnumerator<T>`, e cada `yield return` vira um ponto onde `MoveNext()` salva sua posição e retorna `true`.

## What It Is

Quando um método contém `yield return`, o corpo dele não roda mais quando você o chama. Chamar o método apenas cria o objeto da máquina de estados. O código só começa a executar no primeiro `MoveNext()`, roda até o próximo `yield return`, guarda o valor atual e o "estado" atual (em qual `yield` parou, mais os valores das suas variáveis locais, agora transformadas em campos) e retorna.

Esse design é o que torna os iterators **preguiçosos (lazy)**: você pode descrever uma sequência infinita e só pagar pelos elementos que alguém realmente consome.

## The Surprises

A execução preguiçosa tem dois efeitos colaterais que pegam as pessoas:

1. **A validação de argumentos é adiada.** Um `throw` no topo do iterator não acontece quando o método é chamado, só quando alguém começa a enumerar, possivelmente em um ponto bem distante do código.
2. **Cada enumeração roda o código de novo.** Enumerar o mesmo `IEnumerable<T>` duas vezes (por exemplo, chamar `.Count()` e depois um `foreach`) executa o corpo inteiro duas vezes, incluindo qualquer acesso a banco ou arquivo dentro dele.

## Practical Example

```csharp
static IEnumerable<int> Countdown(int from)
{
    if (from < 0) throw new ArgumentOutOfRangeException(nameof(from));
    for (int i = from; i >= 0; i--)
        yield return i;
}

var seq = Countdown(-1);      // nenhuma exceção ainda!
foreach (var n in seq) { }    // ArgumentOutOfRangeException lançada aqui

// Valida de forma imediata, itera de forma preguiçosa
static IEnumerable<int> SafeCountdown(int from)
{
    ArgumentOutOfRangeException.ThrowIfNegative(from); // roda na chamada
    return Iterate();

    IEnumerable<int> Iterate()
    {
        for (int i = from; i >= 0; i--)
            yield return i;
    }
}
```

## Solution and Conclusion

Use iterators quando a preguiça é o que você quer: streaming, pipelines, sequências potencialmente grandes ou infinitas. Separe a validação em um método que não é iterator, com uma função local fazendo a iteração, e materialize com `.ToList()` quando precisar enumerar o resultado mais de uma vez.

## References

- [yield statement: C# language reference](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/statements/yield) (doc)
- [Iterators: C# guide](https://learn.microsoft.com/en-us/dotnet/csharp/iterators) (doc)
