---
version: 1.0
updatedAt: 2026-09-06
title: O Heap e a Alocação Dinâmica
summary: Memória pedida explicitamente em tempo de execução com `malloc` e liberada explicitamente com `free`, para dados cujo tamanho ou tempo de vida não pode ser preso a nenhuma chamada de função isolada. É o heap real para o qual a realocação por duplicação de um array dinâmico de fato recorre.
---
## Objetivos de Aprendizagem

- Explicar por que alguns dados precisam de um tempo de vida independente de qualquer chamada de função isolada e por que a pilha (vista antes) não consegue oferecer isso.
- Usar `malloc` para pedir um bloco de memória bruta de um dado tamanho e `free` para liberá-lo, casando corretamente cada alocação com exatamente uma liberação.
- Dizer o que `malloc` retorna quando tem sucesso, o que retorna quando falha e por que verificar esse caso de falha importa.
- Rastrear o que de fato acontece, no nível das chamadas a `malloc`, quando um array dinâmico (já visto em abstrato em `data-structures-i`) dobra sua capacidade.
- Contrastar o gerenciamento manual do tempo de vida no heap com a recuperação automática da pilha, identificando qual é a ferramenta certa para um dado pedaço de dados.

## Contexto e Motivação

`the-stack-and-automatic-storage` estabeleceu que a memória de uma variável local está presa exatamente à chamada de função que a contém: criada na entrada e recuperada no retorno, sem nenhum pedido explícito do programador em nenhum dos dois casos. Essa disciplina é eficiente e segura, mas também é uma restrição rígida: não dá suporte a dados cujo tamanho só é conhecido em tempo de execução, nem a dados que precisam sobreviver à função que os criou. O heap é a resposta do espaço de endereçamento do processo para esses dois problemas: uma região de memória da qual o programador pede, explicitamente, por tamanho, em tempo de execução, e pela qual é inteiramente responsável por liberar, explicitamente, sempre que essa memória não for mais necessária.

É neste conceito que `data-structures-i/dynamic-arrays-and-amortized-resizing` finalmente se torna totalmente concreto. Aquela disciplina explicou *por que* dobrar a capacidade de um array dinâmico mantém as inserções no fim em O(1) amortizado, inteiramente em abstrato: "alocar mais espaço e copiar os elementos antigos". Este conceito é o mecanismo literal por trás dessa abstração: "alocar mais espaço" significa uma chamada a `malloc` (ou `realloc`) pedindo um número específico de bytes, e "copiar os elementos antigos" significa uma cópia real de bytes, no estilo de `memcpy`, do bloco antigo para o novo, seguida da liberação do bloco antigo com `free`. Nada sobre arrays dinâmicos foi uma metáfora; sempre foi isto, descrito num nível de abstração que ainda não precisava de ponteiros.

O CS:APP trata a alocação dinâmica de memória como um tema importante por si só (não só a interface de `malloc`, mas as trocas que qualquer alocador precisa enfrentar), e o CS107 de Stanford dedica uma aula posterior, "Managing the Heap", especificamente à disciplina manual que este conceito apresenta, tratando-a como o retorno natural de ter visto a pilha logo antes.

## Teoria Central

### Por que a pilha sozinha não basta

Duas situações que a pilha não consegue tratar de forma limpa motivam diretamente o heap:

1. **Dados cujo tamanho só é conhecido em tempo de execução.** O tamanho de um stack frame é fixo em tempo de compilação (o compilador precisa saber de antemão quanto espaço as variáveis locais de uma função exigem). Um array cujo tamanho depende da entrada do usuário, do tamanho de um arquivo ou de uma resposta de rede não pode ser um array comum alocado na pilha, porque seu tamanho só é conhecido com o programa já rodando.
2. **Dados que precisam sobreviver à função que os criou.** `the-stack-and-automatic-storage` já mostrou que retornar um ponteiro para uma variável local é comportamento indefinido, porque o armazenamento dessa variável é recuperado no instante em que sua função retorna. Qualquer dado feito para ser montado numa função e usado muito depois de essa função ter retornado precisa de um armazenamento que persista independentemente de qualquer chamada específica.

O heap resolve os dois: seu tamanho é pedido explicitamente em tempo de execução (qualquer tamanho que o programa calcule, e não uma constante fixa de tempo de compilação), e seu tempo de vida é inteiramente independente das chamadas de função. Uma alocação no heap persiste até o programa liberá-la explicitamente, não importa quantas funções tenham sido chamadas e retornado nesse meio-tempo.

### `malloc`: pedindo um bloco de memória bruta

```c
void *malloc(size_t size);
```

`malloc` pede `size` bytes de memória ao heap e retorna um `void *` apontando para o início desse bloco; `void *` especificamente porque, como `void-pointers-and-generic-code` mostrou, `malloc` não tem como saber que tipo de dado quem chamou pretende guardar ali. A memória retornada **não é inicializada**: contém os bytes que por acaso estavam lá antes, e não zeros. Então um programa que conta com a memória recém-obtida por `malloc` estar zerada está contando com uma suposição que a linguagem não garante.

```c
int *nums = malloc(10 * sizeof(int));   /* pede espaço para 10 ints */
if (nums == NULL) {
    /* malloc falhou: o sistema não tinha mais memória para dar */
    return;
}
nums[0] = 42;   /* agora é seguro usar, exatamente como um array alocado na pilha */
```

Comparar o ponteiro retornado com `NULL` não é burocracia defensiva: `malloc` de fato pode falhar, e falha, mais comumente quando o sistema está sem memória disponível, e desreferenciar um resultado `NULL` é comportamento indefinido, de imediato.

### `free`: devolvendo um bloco ao heap

```c
void free(void *ptr);
```

`free` libera um bloco de memória do heap retornado antes por `malloc`, deixando-o disponível para alocações futuras. Todo `malloc` bem-sucedido precisa ser casado em algum momento com exatamente um `free`: nunca zero (um vazamento, visto em `common-memory-bugs-leaks-and-dangling-pointers`) e nunca mais de um (um double free, também visto lá):

```c
int *nums = malloc(10 * sizeof(int));
/* ... usa nums ... */
free(nums);        /* libera o bloco */
nums = NULL;        /* boa prática: evita usar nums de novo por acidente */
```

Atribuir `NULL` a `nums` logo depois de liberá-lo é um hábito defensivo, e não uma exigência da linguagem: ele converte um uso acidental posterior de `nums` de um bug silencioso de comportamento indefinido numa falha imediata e óbvia ao desreferenciar `NULL`.

### Arrays dinâmicos, tornados literais

`data-structures-i/dynamic-arrays-and-amortized-resizing` descreveu a duplicação de capacidade inteiramente em abstrato. Eis o mecanismo, exatamente:

```c
int *arr = malloc(4 * sizeof(int));   /* capacidade inicial: 4 */
int capacity = 4, length = 0;

/* ... arr enche até length == capacity ... */

int newCapacity = capacity * 2;                          /* dobra */
int *newArr = malloc(newCapacity * sizeof(int));           /* aloca um bloco maior */
memcpy(newArr, arr, length * sizeof(int));                 /* copia os elementos antigos */
free(arr);                                                  /* libera o bloco antigo */
arr = newArr;
capacity = newCapacity;
```

Isso é precisamente "alocar mais espaço e copiar os elementos antigos" da descrição abstrata, agora expresso como uma chamada real a `malloc` para o bloco maior, um `memcpy` real (ou um laço manual equivalente) copiando cada elemento existente e um `free` real liberando o bloco que não é mais necessário. O argumento de O(1) amortizado que `dynamic-arrays-and-amortized-resizing` já provou matematicamente se aplica aqui sem mudança: nunca foi uma aproximação, ele descrevia exatamente essa sequência de operações no heap.

```mermaid
flowchart LR
    A["arr: capacidade 4, cheio"] -->|"malloc(8 * sizeof(int))"| B["newArr: capacidade 8, vazio"]
    A -->|"memcpy: copia 4 elementos"| B
    A -->|"free(arr)"| C["bloco antigo liberado"]
    B -->|"arr = newArr"| D["arr agora aponta para o bloco novo e maior"]
```

## Exemplos Resolvidos

### Exemplo 1: uma struct alocada no heap que sobrevive à função que a criou

```c
struct Node *makeNode(int value) {
    struct Node *n = malloc(sizeof(struct Node));   /* alocação no heap, não local */
    n->value = value;
    n->next = NULL;
    return n;    /* seguro: n aponta para memória do heap, que sobrevive a makeNode */
}

int main(void) {
    struct Node *head = makeNode(1);
    /* head continua válido aqui, mesmo com makeNode já tendo retornado */
    printf("%d\n", head->value);
    free(head);
}
```

Esta é a correção direta do padrão que `the-stack-and-automatic-storage` mostrou ser comportamento indefinido: em vez de retornar um ponteiro para uma variável local (na pilha), `makeNode` aloca sua `struct Node` no heap, que persiste exatamente pelo tempo que o programa quiser, independentemente de `makeNode` já ter retornado. Toda lista ligada real construída em C (como `singly-linked-lists` descreveu em abstrato) aloca seus nós exatamente assim.

### Exemplo 2: falha de `malloc`, tratada corretamente

```c
int *hugeArray = malloc(1000000000000UL * sizeof(int));   /* um pedido absurdamente grande */

if (hugeArray == NULL) {
    fprintf(stderr, "allocation failed: not enough memory\n");
    return 1;
}
/* o código aqui só rodaria se a alocação de fato tivesse sucesso */
```

Na maioria dos sistemas reais, um pedido desse tamanho falha, e `malloc` retorna `NULL` em vez de travar ou lançar uma exceção: a convenção de tratamento de erros de C para esta função é um valor de retorno, e não um mecanismo de exceção da linguagem. Código que pula a verificação de `NULL` e desreferencia `hugeArray` de imediato invoca comportamento indefinido no momento em que a alocação de fato falhar, o que sistemas reais acabam fazendo sob pressão de memória, mesmo para pedidos que pareciam razoáveis.

### Exemplo 3: casando cada `malloc` com exatamente um `free`

```c
void processData(int n) {
    int *buffer = malloc(n * sizeof(int));
    if (buffer == NULL) return;

    for (int i = 0; i < n; i++) {
        buffer[i] = i * i;
    }

    /* ... usa buffer ... */

    free(buffer);   /* exatamente um free, casando com exatamente o único malloc acima */
}
```

Todo caminho por `processData` que aloca `buffer` com sucesso também chega ao `free` correspondente: a disciplina que `common-memory-bugs-leaks-and-dangling-pointers` vai formalizar como a origem de vazamentos (um caminho que aloca mas nunca libera) e de double frees (um caminho que libera duas vezes) sempre que for violada. Acertar essa correspondência um para um, para todo caminho possível por uma função, incluindo retornos antecipados e ramos de erro, é toda a disciplina do gerenciamento manual de memória em C.

## Equívocos Comuns e Armadilhas

- **"A memória obtida por `malloc` começa zerada, como as globais na BSS."** Não começa: `malloc` retorna memória bruta, não inicializada, com os bytes que já estavam lá. Um programa que precisa de memória zerada deve usar `calloc`, que garante explicitamente o zeramento, ou zerar a memória manualmente.
- **"Verificar se o retorno de `malloc` é `NULL` é código defensivo desnecessário."** `malloc` de fato falha em condições reais (o sistema ficando com pouca memória), e desreferenciar seu resultado `NULL` é comportamento indefinido. Pular a verificação não impede a falha; só a torna silenciosa e muito mais difícil de diagnosticar.
- **"Depois de dar `free` num ponteiro, o próprio ponteiro vira `NULL` automaticamente."** `free` libera a memória à qual o ponteiro se refere; não modifica a própria variável ponteiro, que continua guardando o mesmo endereço (agora inválido) depois disso. Atribuir `NULL` manualmente, como mostrado na seção de Teoria Central, é um passo separado e deliberado.
- **"O redimensionamento de um array dinâmico é um mecanismo diferente do `malloc`/`free` comum."** É o mesmo mecanismo, aplicado em sequência: um `malloc` maior, uma cópia do conteúdo antigo e um `free` do bloco antigo, exatamente como a seção de Teoria Central deste conceito explicita. Nada de novo é introduzido pelo redimensionamento além de compor operações já vistas.

## Resumo

O heap é a região do espaço de endereçamento do processo reservada para memória pedida explicitamente em tempo de execução, via `malloc`, e liberada explicitamente, via `free`. Ele resolve os dois problemas que o armazenamento automático da pilha, preso às chamadas de função, não consegue resolver: dados cujo tamanho só é conhecido em tempo de execução e dados que precisam sobreviver à função que os criou. `malloc` retorna um `void *` (memória não inicializada) ou `NULL` em caso de falha, e toda alocação bem-sucedida precisa ser casada com exatamente um `free`, nunca zero e nunca mais de um. Isso não é uma regra abstrata: é o mecanismo literal por trás da duplicação de capacidade de `data-structures-i/dynamic-arrays-and-amortized-resizing` (um `malloc` maior, uma cópia real de bytes dos elementos existentes e um `free` do bloco que não é mais necessário), provando que o argumento de O(1) amortizado daquele conceito nunca foi uma simplificação, só uma descrição um nível de abstração acima dos ponteiros que este conceito agora fornece.

## Documentation Links

- [Bryant & O'Hallaron: Computer Systems: A Programmer's Perspective (CS:APP)](https://csapp.cs.cmu.edu/): livro-texto que cobre a alocação dinâmica de memória como um tema importante e dedicado.
- [Stanford CS107: General Information and Syllabus](https://web.stanford.edu/class/cs107/syllabus): curso que coloca a pilha e o heap em aulas consecutivas, contrastando a disciplina de memória automática com a manual.
