---
version: 1.0
updatedAt: 2026-10-20
title: "Execução Simbólica e Teste Concólico"
summary: "A execução simbólica roda um programa com entradas simbólicas, coletando uma condição de caminho em cada desvio e perguntando a um solver SMT se cada caminho é viável e qual entrada concreta o percorre. O teste concólico mistura execução concreta e simbólica para gerar um teste para cada caminho que consegue alcançar, ao preço da explosão de caminhos e de pouco raciocínio sobre laços, memória e o ambiente."
---
## Objetivos de Aprendizagem

- Descrever a execução simbólica: estado simbólico, condições de caminho, bifurcação nos desvios e o uso de um solver SMT para decidir a viabilidade de um caminho e produzir uma entrada de teste concreta.
- Executar simbolicamente à mão um programa pequeno e enumerar suas condições de caminho.
- Explicar o teste concólico (DART, CUTE, SAGE) como execução concreta mais contabilidade simbólica, e rodar o seu laço de "negar o último desvio".
- Nomear os principais obstáculos (explosão de caminhos, laços, memória, o ambiente) e as mitigações que as ferramentas reais usam.

## Contexto e Motivação

`ai-theory/formal-methods` apresentou os solvers SMT como procedimentos de decisão para fórmulas lógicas, e `algorithms-software/software-construction` apresentou a cobertura como medida de quanto de um programa os testes exercitam. Um gerador de testes aleatório tem um problema de cobertura: em `if (x == 123456789)` o desvio é tomado por uma entrada em $2^{32}$, então entradas aleatórias nunca chegam ao código atrás dele. Um testador humano lê a condição e escolhe o valor. A **execução simbólica** automatiza essa leitura: em vez de rodar o programa com um valor concreto, roda com um simbólico, registra a condição sob a qual cada caminho é tomado e pede a um solver uma entrada que a satisfaça.

King propôs a técnica em 1976, mas ela só se tornou prática quando os solvers ficaram rápidos e uma ideia nova (misturar execução concreta e simbólica) removeu a maior parte dos seus pontos fracos. As ferramentas que vieram incluem DART e CUTE (2005), KLEE (2008, construído sobre bitcode LLVM), o SAGE da Microsoft (whitebox fuzzing, usado em parsers de arquivos do Windows e do Office), angr (para binários) e Symbolic PathFinder (para bytecode Java). A revisão de Baldoni et al. mapeia a área.

## Teoria Central

### Estado simbólico e condições de caminho

Um executor simbólico mantém um **armazenamento simbólico** que leva cada variável a uma expressão sobre os símbolos de entrada, e uma **condição de caminho** $\pi$, uma fórmula sobre as entradas que precisa valer para a execução estar no caminho corrente. As entradas começam como símbolos, $x \mapsto \alpha$, $y \mapsto \beta$. Uma atribuição `z = 2 * y` atualiza o armazenamento: $z \mapsto 2\beta$. Um desvio `if (c)` bifurca o estado em dois: um com $\pi \wedge c[\text{armazenamento}]$, o outro com $\pi \wedge \neg c[\text{armazenamento}]$. Antes de continuar um ramo, o executor pergunta ao **solver SMT** se a nova condição de caminho é satisfazível; se não é, o caminho é inviável e é abandonado.

Quando um caminho termina (retorno, falha de asserção, crash), o solver é consultado por um **modelo** de $\pi$, valores concretos para as entradas que levam o programa exatamente por aquele caminho. Um teste por caminho dá alta cobertura automaticamente, e checar em cada operação arriscada (divisão, índice de array, asserção) se a condição de caminho junto com a condição de erro é satisfazível acha bugs reais com uma testemunha.

### Os obstáculos

- **Explosão de caminhos**: o número de caminhos é exponencial no número de desvios, e ilimitado com laços. As ferramentas usam heurísticas de busca (em profundidade, aleatória, guiada por cobertura), fusão de estados, desenrolar de laços com limite e limites de tempo.
- **Custo e expressividade do solver**: aritmética não linear, ponto flutuante e strings são caros, e funções de hash são intratáveis por projeto.
- **Memória**: ponteiros com valores simbólicos. Um índice simbólico num array vira um termo da teoria de arrays do SMT; um ponteiro simbólico pode se referir a muitos objetos e obriga o executor a bifurcar ou modelá-los (o KLEE representa a memória como arrays de bytes com conteúdo simbólico).
- **O ambiente**: chamadas de sistema, arquivos e código de biblioteca não podem todos ser executados simbolicamente, então as ferramentas os substituem por *modelos* (os modelos de uclibc e POSIX do KLEE) ou os executam concretamente.

### Teste concólico

O teste **concólico** (concreto + simbólico), introduzido pelo DART (Godefroid, Klarlund, Sen, PLDI 2005), roda o programa com uma entrada concreta e constrói a condição de caminho simbólica ao longo dessa única execução. Depois procura a próxima entrada:

1. Rodar com alguma entrada e registrar as condições de desvio $c_1, \ldots, c_k$ efetivamente tomadas.
2. Escolher um desvio $i$, formar $c_1 \wedge \ldots \wedge c_{i-1} \wedge \neg c_i$ e pedir um modelo ao solver.
3. Rodar de novo com esse modelo: ele segue o mesmo prefixo e diverge no desvio $i$. Repetir, explorando a árvore de caminhos.

Sempre que o raciocínio simbólico não dá conta (uma chamada de hash, uma chamada de sistema sem modelo), os valores concretos da execução real são usados no lugar, então a técnica se degrada com elegância em vez de falhar. É por isso que ferramentas concólicas lidam com programas reais que executores puramente simbólicos não conseguem. O SAGE aplica o mesmo laço a parsers de arquivos e, segundo os autores, achou muitos bugs de segurança no Windows e no Office, o que levou à descrição como *whitebox fuzzing*.

### Relação com outras técnicas

A execução simbólica é *precisa por caminho* e *incompleta entre caminhos*; a interpretação abstrata é o oposto, cobrindo todos os caminhos de forma imprecisa. Os bugs que ela reporta vêm com uma entrada concreta que falha, então não há falsos positivos vindos da lógica de caminhos (exceto lacunas de modelagem). Ela complementa o fuzzing guiado por cobertura, tratado em um conceito posterior: um fuzzer é rápido em caminhos rasos e fraco em condições estreitas como checksums e números mágicos, enquanto o raciocínio simbólico resolve essas condições diretamente. Ferramentas híbridas (Driller, QSym) rodam os dois.

## Exemplos Resolvidos

### Exemplo 1: enumerando caminhos à mão

**Problema:** Executar simbolicamente a função a seguir e listar as condições de caminho.

```c
int f(int x, int y) { return 2 * y; }

void h(int x, int y) {
    int z = f(x, y);
    if (z == x) {
        if (x > y + 10) {
            abort();
        }
    }
}
```

**Solução:** Comece com $x \mapsto \alpha$, $y \mapsto \beta$. A chamada dá $z \mapsto 2\beta$. O primeiro desvio compara $2\beta$ com $\alpha$ e bifurca: o caminho 1 tem $\pi_1 = (2\beta \neq \alpha)$ e retorna. O caminho 2 tem $\pi_2 = (2\beta = \alpha) \wedge (\alpha \leq \beta + 10)$ e retorna. O caminho 3 tem $\pi_3 = (2\beta = \alpha) \wedge (\alpha > \beta + 10)$ e chega a `abort()`. Para achar uma entrada que dispara o abort, peça ao solver um modelo de $\pi_3$: substituindo $\alpha = 2\beta$ obtém-se $2\beta > \beta + 10$, ou seja, $\beta > 10$. O modelo $\beta = 11$, $\alpha = 22$ é uma resposta, então `h(22, 11)` aborta. Um testador aleatório precisaria adivinhar $x = 2y$ entre $2^{32}$ valores de $x$ para cada $y$.

### Exemplo 2: uma execução concólica

**Problema:** Rodar o laço do DART em `h`, partindo da entrada aleatória $x = 269167349$, $y = 889801541$.

**Solução:** Execução 1 (concreta): $z = 2y = 1779603082 \neq x$, então o desvio `z == x` é falso. A condição registrada é $c_1 = (2y \neq x)$. Negue-a: $2y = x$. O solver devolve, digamos, $x = 0, y = 0$. Execução 2: agora `z == x` é verdadeiro, e depois `x > y + 10` é falso; o caminho registrado é $(2y = x) \wedge (x \leq y + 10)$. Negue a última condição: $(2y = x) \wedge (x > y + 10)$. O solver devolve $x = 22, y = 11$ (ou qualquer outra solução). A execução 3 chega a `abort()`. Três execuções acharam o bug, cada uma guiada por uma consulta ao solver, e nenhuma precisou entender a estrutura do programa. (Em aritmética real de 32 bits, o solver também modela o overflow de `2 * y`, o que acrescenta mais soluções.)

### Exemplo 3: onde a técnica trava

**Problema:** Por que um executor puramente simbólico não resolve `if (sha256(input) == target) bug();`, e o que uma ferramenta concólica faz?

**Solução:** Escrever a condição de caminho exige expressar o cálculo do hash como restrições, e invertê-lo é um problema de pré-imagem que o solver não consegue resolver com eficiência, por projeto do hash. Um executor puramente simbólico trava nesse desvio. Uma ferramenta concólica trata a chamada de hash como função opaca: executa-a com a entrada concreta e usa o resultado concreto, perdendo a dependência simbólica, e segue para outros desvios. O caminho de `bug()` continua sem ser alcançado, uma limitação que nenhuma técnica remove, mas o resto do programa ainda é explorado em vez de a análise inteira falhar.

## Equívocos Comuns e Armadilhas

- **"A execução simbólica prova que o programa está correto."** Só se explorar até o fim todos os caminhos viáveis, o que é possível apenas para programas com finitos caminhos (laços limitados, entradas pequenas). Fora isso é um caçador de bugs, com evidência forte do que deixou de cobrir.
- **"Não produz falsos positivos."** Uma entrada que falha reportada é uma execução real se o modelo do ambiente é fiel. Modelos imprecisos de chamadas de biblioteca, ponto flutuante ou layout de memória podem gerar entradas que não se reproduzem no sistema real, então os relatórios devem ser reexecutados.
- **"Um solver mais rápido resolve a explosão de caminhos."** O número exponencial de caminhos é o problema, não o custo por consulta. Estratégias de busca, fusão de estados, resumos de funções e restrição das entradas simbólicas importam mais do que a velocidade do solver.
- **"Execução concólica e simbólica são ferramentas diferentes."** São a mesma ideia com tratamentos diferentes do que o motor simbólico não consegue representar: executores puramente simbólicos param ou aproximam, os concólicos recorrem ao valor concreto.

## Resumo

A execução simbólica roda um programa com entradas simbólicas, mantendo um armazenamento simbólico e uma condição de caminho que um solver SMT confere quanto à viabilidade e transforma numa entrada de teste concreta para cada caminho. Ela acha bugs profundos que o teste aleatório perde, mas sofre com explosão de caminhos, limites do solver, memória simbólica e o ambiente. O teste concólico roda concretamente enquanto registra a condição de caminho simbólica, depois nega um desvio para guiar a próxima execução, e recorre a valores concretos onde o raciocínio falha; DART, SAGE e KLEE são suas realizações mais conhecidas. O próximo conceito passa da análise do significado do programa à prova contra uma especificação: a lógica de separação, a ferramenta para raciocinar sobre programas que usam ponteiros.

## Documentation Links

- [King: Symbolic Execution and Program Testing (Communications of the ACM, 1976)](https://dl.acm.org/doi/10.1145/360248.360252): doc
- [Cadar, Dunbar, Engler: KLEE: Unassisted and Automatic Generation of High-Coverage Tests for Complex Systems Programs (OSDI 2008)](https://www.usenix.org/legacy/event/osdi08/tech/full_papers/cadar/cadar.pdf): doc
- [Godefroid, Klarlund, Sen: DART: Directed Automated Random Testing (PLDI 2005)](https://dl.acm.org/doi/10.1145/1065010.1065036): doc
- [Baldoni et al.: A Survey of Symbolic Execution Techniques (ACM Computing Surveys, 2018)](https://arxiv.org/abs/1610.00502): doc
