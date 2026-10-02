---
version: 1.0
updatedAt: 2026-09-06
title: void* e Código Genérico
summary: Um ponteiro sem tipo, que pode apontar para qualquer coisa, mas não pode ser desreferenciado como nada até receber uma conversão (cast). É o truque que `malloc`, `qsort` e `memcpy` usam para continuar genéricos numa linguagem sem templates.
---
## Objetivos de Aprendizagem

- Explicar o que `void *` significa: um ponteiro que sabidamente guarda algum endereço, deliberadamente sem nenhuma informação sobre que tipo de objeto mora ali.
- Dizer por que um `void *` não pode ser desreferenciado diretamente e por que precisa ser convertido para um tipo de ponteiro concreto antes que o objeto para o qual aponta possa ser lido ou escrito.
- Ler e explicar a assinatura de `malloc`, `memcpy` e `qsort`, identificando exatamente onde e por que cada uma usa `void *` para continuar genérica.
- Implementar uma função genérica simples de contêiner (por exemplo, uma troca byte a byte de dois objetos arbitrários) usando `void *` e um parâmetro de tamanho explícito.
- Contrastar essa técnica com genéricos de verdade em tempo de compilação, explicando do que `void *` abre mão (segurança de tipos, verificação em tempo de compilação) em troca da generalidade.

## Contexto e Motivação

Todo ponteiro visto até agora nesta disciplina sabia, em tempo de compilação, exatamente para que tipo de objeto apontava: `int *`, `struct Node *`, um ponteiro para função com uma assinatura fixa. `void *` quebra esse padrão de propósito: é um ponteiro com a garantia de guardar *algum* endereço válido, sem dizer absolutamente nada sobre que tipo de objeto está guardado ali. Isso não é uma lacuna no sistema de tipos; é o mecanismo de C para escrever código que precisa funcionar com dados de qualquer tipo, decidido depois, sem conhecer esse tipo de antemão.

Isso importa de forma imediata e concreta, porque as funções da biblioteca padrão usadas o tempo todo nesta disciplina só são possíveis por causa de `void *`. `malloc`, vista em `the-heap-and-dynamic-allocation`, retorna `void *` porque não tem ideia, no momento em que aloca memória, do que quem chamou pretende guardar ali: um bloco de memória bruta não é inerentemente um array de `int`s ou uma `struct Node`, até quem chamou decidir. `memcpy` copia bytes entre dois argumentos `void *` porque uma cópia byte a byte não se importa com o tipo de nenhum dos lados. `qsort`, a ordenação genérica da biblioteca padrão de C, recebe um array como `void *` e uma função de comparação (um ponteiro para função, visto em `function-pointers`) justamente para conseguir ordenar um array de qualquer tipo de elemento sem ser reescrita para cada um.

O CS107 e o CS:APP tratam `void *` como a resposta prática a uma tensão de projeto real: C não tem templates nem genéricos embutidos na linguagem (ao contrário de C++, por exemplo), então qualquer função feita para operar sobre tipos arbitrários precisa de algum jeito de aceitar "um ponteiro para alguma coisa, tipo não especificado", e `void *`, junto com um tamanho explícito (em bytes) que diz à função quantos dados ela de fato deve tocar, é essa resposta.

## Teoria Central

### `void *`: um endereço com o tipo deliberadamente apagado

Um `void *` é declarado e atribuído exatamente como qualquer outro ponteiro, guardando o endereço de algum objeto real, mas o compilador não acompanha nenhuma informação sobre qual é o tipo desse objeto:

```c
int x = 5;
void *vp = &x;   /* vp guarda o endereço de x, mas "esquece" que aponta para um int */
```

Como o compilador não sabe mais o tipo do alvo, ele não tem como determinar quantos bytes ler nem como interpretá-los, e é exatamente por isso que um `void *` não pode ser desreferenciado diretamente. `*vp` é um erro de compilação; o ponteiro precisa primeiro ser convertido de volta para um tipo concreto:

```c
int y = *(int *)vp;   /* converte vp de volta para int* e depois desreferencia: y == 5 */
```

A conversão é a promessa de quem chama ao compilador: "confie em mim, o objeto neste endereço é mesmo um `int`". C não faz nenhuma verificação em tempo de execução de que essa promessa seja verdadeira; errar a conversão (converter para o tipo errado, ou para um tipo de tamanho errado) é comportamento indefinido, e não um erro detectado.

### A assinatura de `malloc` é o exemplo real mais claro

```c
void *malloc(size_t size);
```

`malloc` aloca `size` bytes de memória bruta e não inicializada e retorna um `void *` apontando para o início desse bloco. Ela não pode retornar, digamos, um `int *`, porque `malloc` não tem ideia se quem chamou pretende guardar `int`s, `struct Node`s ou bytes brutos ali: o tipo de retorno precisa continuar genérico, e quem chama fornece a informação de tipo que falta, convertendo o resultado:

```c
int *nums = (int *)malloc(10 * sizeof(int));   /* memória bruta para 10 ints, convertida para int* */
```

O tamanho passado a `malloc` (`10 * sizeof(int)`) é ele próprio calculado com `sizeof`, exatamente porque um `void *` sozinho não carrega nenhuma informação de tamanho que quem chama poderia consultar depois: quem chama sempre precisa acompanhar, separadamente, quanta memória pediu e o que pretende fazer com ela.

### `memcpy`: genérica porque opera um byte por vez

```c
void *memcpy(void *dest, const void *src, size_t n);
```

`memcpy` copia `n` bytes de `src` para `dest` sem nunca precisar saber para que tipo cada ponteiro de fato aponta: uma cópia byte a byte tem significado qualquer que seja o tipo do alvo, então `memcpy` continua genérica operando puramente em termos de bytes brutos e de uma contagem explícita, sem nunca tentar interpretar os dados que move.

### `qsort`: ordenação genérica via `void *` mais um ponteiro para função

```c
void qsort(void *base, size_t nmemb, size_t size,
           int (*compar)(const void *, const void *));
```

`qsort` ordena um array de `nmemb` elementos, cada um com `size` bytes, começando em `base`. Os três parâmetros juntos substituem a informação de tipo de que uma ordenação genérica precisaria: `base` é onde os dados moram, `size` é quanto avançar para ir de um elemento ao próximo (já que `qsort` não pode usar aritmética de ponteiros tipada, vista em `pointer-arithmetic-and-array-decay`, num `void *`), e `compar` (um ponteiro para função, visto em `function-pointers`) é como comparar quaisquer dois elementos, fornecido por quem chama, já que a própria `qsort` não tem ideia do que "menor que" significa para um tipo arbitrário.

```mermaid
flowchart LR
    Caller["Quem chama sabe: isto é um array de int"] -->|"converte para void*, passa o tamanho explicitamente"| QSort["qsort: opera de forma genérica\n(base, nmemb, size, compar)"]
    QSort -->|"chama de volta"| Compar["compar() fornecida por quem chama\nsabe comparar ints"]
```

## Exemplos Resolvidos

### Exemplo 1: uma troca genérica byte a byte usando `void *`

```c
void genericSwap(void *a, void *b, size_t size) {
    unsigned char *pa = (unsigned char *)a;
    unsigned char *pb = (unsigned char *)b;

    for (size_t i = 0; i < size; i++) {
        unsigned char tmp = pa[i];
        pa[i] = pb[i];
        pb[i] = tmp;
    }
}

int x = 1, y = 2;
genericSwap(&x, &y, sizeof(int));      /* troca dois ints */

struct Point { int x, y; };
struct Point p1 = {1, 1}, p2 = {2, 2};
genericSwap(&p1, &p2, sizeof(struct Point));   /* troca duas structs, mesma função */
```

`genericSwap` nunca menciona `int` nem `struct Point` em lugar nenhum do seu corpo: trata o que recebe como uma sequência de bytes brutos (`unsigned char *`, escolhido especificamente porque `sizeof(unsigned char)` é sempre exatamente 1 byte) e os troca um byte por vez. A mesma função troca corretamente dois inteiros ou duas structs, porque uma troca byte a byte produz o resultado correto qualquer que seja o significado desses bytes.

### Exemplo 2: chamando `qsort` com um comparador real

```c
int compareInts(const void *a, const void *b) {
    int ia = *(const int *)a;    /* converte de volta para int* para de fato comparar */
    int ib = *(const int *)b;
    return ia - ib;
}

int nums[5] = {5, 2, 4, 1, 3};
qsort(nums, 5, sizeof(int), compareInts);
/* nums agora é {1, 2, 3, 4, 5} */
```

`qsort` chama `compareInts` internamente, passando dois argumentos `void *` que apontam para os dois elementos que ela precisa comparar no momento. `compareInts` converte imediatamente os dois de volta para `const int *` e os desreferencia (exatamente o mesmo padrão de converter e depois desreferenciar da seção de Teoria Central), porque a própria `qsort` apagou o tipo do elemento, e só o comparador fornecido por quem chama sabe como restaurá-lo.

### Exemplo 3: do que `void *` abre mão, em comparação com genéricos de verdade

```c
/* versão com void*: compila sem problemas mesmo com uma conversão incompatível; nenhum erro até a execução */
double *bad = (double *)malloc(sizeof(int));
*bad = 3.14;   /* comportamento indefinido: só sizeof(int) bytes foram de fato alocados */
```

Não há como o compilador pegar esse erro: `malloc(sizeof(int))` de fato retorna um `void *`, e convertê-lo para `double *` é aceito sem reclamação, mesmo que um `double` precise de mais bytes do que foram alocados. Esse é o custo real da generalidade baseada em `void *`: ela compra a capacidade de escrever uma função para muitos tipos, mas ao preço de toda verificação de segurança de tipos que um sistema de genéricos de verdade (templates em tempo de compilação, ou a tipagem dinâmica do Python pegando a incompatibilidade no ponto de uso) normalmente ofereceria. A conversão do programador é a única coisa entre o comportamento correto e o indefinido.

## Equívocos Comuns e Armadilhas

- **"`void *` significa 'um ponteiro para nada' ou 'um ponteiro nulo'."** Significa "um ponteiro para alguma coisa, de tipo não especificado", muito diferente de `NULL`, que significa "um ponteiro para nada". Um `void *` pode guardar (e normalmente guarda) um endereço perfeitamente válido e não nulo; ele só perdeu sua informação de tipo.
- **"Dá para desreferenciar um `void *` diretamente, como qualquer outro ponteiro."** Não dá: o compilador não tem ideia de quantos bytes ler nem de como interpretá-los. Um `void *` precisa primeiro ser convertido para um tipo de ponteiro concreto antes de ser desreferenciado.
- **"A generalidade baseada em `void *` é tão segura quanto genéricos de verdade."** Não é: converter um `void *` para o tipo errado compila sem erro e produz comportamento indefinido em tempo de execução, exatamente como mostra o Exemplo 3. Genéricos de verdade (templates em tempo de compilação em outras linguagens) pegam essa classe de erro antes de o programa sequer rodar.
- **"`memcpy` e `qsort` são técnicas sem relação."** As duas resolvem o mesmo problema de fundo (escrever uma função que funcione com muitos tipos) usando a mesma ideia central: apagar o tipo com `void *` e passar a informação extra de que a função precisa para operar corretamente sem esse tipo (uma contagem de bytes para `memcpy`, um tamanho e um comparador para `qsort`).

## Resumo

`void *` é um ponteiro que C garante guardar algum endereço válido, descartando deliberadamente qualquer informação sobre que tipo de objeto mora ali: ele não pode ser desreferenciado diretamente e precisa primeiro ser convertido para um tipo concreto, uma conversão cuja correção o compilador nunca verifica. Esse é o mecanismo por trás de toda função genuinamente genérica da biblioteca padrão de C: `malloc` retorna `void *` porque não tem como saber o que quem chama pretende guardar; `memcpy` opera sobre `void *` porque uma cópia byte a byte não precisa saber o tipo de nenhum dos lados; `qsort` combina um array `void *`, um tamanho de elemento explícito e um ponteiro para função de comparação fornecido por quem chama para ordenar dados de qualquer tipo sem nunca saber que tipo é esse. A troca é real e inevitável: a generalidade baseada em `void *` compra flexibilidade ao custo direto de toda verificação de tipos em tempo de compilação que um sistema de genéricos de verdade ofereceria.

## Documentation Links

- [Bryant & O'Hallaron: Computer Systems: A Programmer's Perspective (CS:APP)](https://csapp.cs.cmu.edu/): livro-texto que cobre `void *` e as funções da biblioteca padrão construídas em torno dele.
- [Stanford CS107: General Information and Syllabus](https://web.stanford.edu/class/cs107/syllabus): curso que trata `void *` como material inicial central, junto com ponteiros e ponteiros para função.
