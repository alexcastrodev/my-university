---
version: 1.0
updatedAt: 2026-08-13
title: "Busca de Substring: Da Força Bruta ao Knuth-Morris-Pratt"
description: "Como o pior caso O(NM) da busca de substring por força bruta em entrada auto-repetitiva motiva a ideia-chave do Knuth-Morris-Pratt: um mismatch já te diz o suficiente sobre o texto para construir um pequeno autômato a partir do padrão e varrer o texto uma vez, sem retroceder, em O(N)."
---
## Objetivo

Entenda a busca de substring: encontrar um padrão de comprimento M dentro de um texto de comprimento N. Comece pela abordagem óbvia de força bruta e seu pior caso O(NM), depois veja a percepção — um mismatch já diz algo sobre o texto que você acabou de varrer — que o Knuth-Morris-Pratt (KMP) transforma num pequeno autômato construído uma vez a partir do padrão, permitindo varrer o texto exatamente uma vez, da esquerda para a direita, sem retroceder, em O(N) depois do pré-processamento.

## Casos de Uso

- A funcionalidade "buscar" de um editor de texto ou navegador, ou uma busca estilo `grep` por uma string fixa dentro de um log ou documento grande.
- Varrer um fluxo de entrada que você não pode rebobinar — tráfego de rede, `stdin`, uma mensagem interceptada — onde um algoritmo que nunca retrocede o ponteiro do texto evita ter que armazenar em buffer caracteres já consumidos.
- Detecção de assinatura/padrão contra um corpo de texto longo e fixo (uma frase importante numa comunicação interceptada, uma string marcadora conhecida num blob binário grande) onde o mesmo padrão curto é buscado repetidamente.

## Aprofundamento

### Busca de substring por força bruta e seu pior caso

O algoritmo óbvio: para toda posição inicial `i` possível no texto, verifique se o padrão bate caractere por caractere, parando no primeiro mismatch.

```java
public static int search(String pat, String txt) {
    int M = pat.length();
    int N = txt.length();
    for (int i = 0; i <= N - M; i++) {
        int j;
        for (j = 0; j < M; j++)
            if (txt.charAt(i + j) != pat.charAt(j)) break;
        if (j == M) return i; // encontrado
    }
    return N; // não encontrado
}
```

Sedgewick e Wayne também dão uma versão de "retrocesso explícito" que mantém um único índice `i` no texto (rastreando `i + j` da versão acima) e um segundo índice `j` no padrão, incrementando os dois juntos numa correspondência e resetando num mismatch. Nomear o reset explicitamente é o que importa aqui — é exatamente a operação que o KMP foi feito para evitar:

```java
public static int search(String pat, String txt) {
    int M = pat.length(), N = txt.length();
    int i, j;
    for (i = 0, j = 0; i < N && j < M; i++) {
        if (txt.charAt(i) == pat.charAt(j)) j++;
        else { i -= j; j = 0; } // retrocede: tenta de novo começando uma posição depois
    }
    if (j == M) return i - M; // encontrado
    else return N;            // não encontrado
}
```

Em texto típico isso é rápido — quase todo mismatch acontece já no primeiro caractere do padrão, então o tempo de execução fica próximo de N. Mas o pior caso é genuinamente O(NM): faça padrão e texto serem sequências do mesmo caractere repetido seguidas por um caractere diferente. Pegue o padrão `"AAAB"` (M = 4) contra o texto `"AAAAAAAAAAAAAAAB"` (quinze `A`s seguidos de um `B`, N = 16). Em toda posição inicial `i` de 0 a 11, os três primeiros caracteres batem (`"AAA"` contra `"AAA"`), e só a quarta comparação — o `'B'` do padrão contra o `'A'` do texto — falha. Quase o padrão inteiro é recomparado em cada uma das doze posições iniciais que falham antes de a correspondência finalmente ser encontrada em `i = 12`. A Proposição M de Sedgewick e Wayne declara o resultado geral: a busca por força bruta exige ~NM comparações de caractere no pior caso.

```viz
type: moves
mark 3 | pat = "AAAB". Tentativa i=0: text[0..2] = "AAA" bate com pat[0..2], mas text[3] = 'A' vs pat[3] = 'B' dá mismatch na 4ª comparação.
mark 4 | Tentativa i=1: a força bruta reseta j para 0 e desliza a janela em exatamente uma posição. Mesma história — text[1..3] = "AAA" bate, depois text[4] = 'A' vs pat[3] = 'B' dá mismatch de novo.
mark 5 | Tentativa i=2: forma idêntica, mismatch uma posição depois. Isso se repete para toda posição inicial até i=11 -- quase o padrão inteiro é recomparado toda vez.
mark 14 | Tentativa i=11, a última posição inicial que falha: text[11..13] = "AAA" bate, text[14] = 'A' vs pat[3] = 'B' dá mismatch uma última vez.
mark 12 | Tentativa i=12: text[12] = 'A' bate com pat[0] = 'A'.
mark 13 | text[13] = 'A' bate com pat[1] = 'A'.
mark 14 | text[14] = 'A' bate com pat[2] = 'A'.
mark 15 | text[15] = 'B' bate com pat[3] = 'B' — correspondência completa. search() retorna i = 12, depois de aproximadamente M(N-M-1) ≈ 4×11 comparações de caractere: o pior caso O(NM) em ação.
---
A
A
A
A
A
A
A
A
A
A
A
A
A
A
A
B
```

### A percepção central do KMP: um mismatch já te diz algo

O `i -= j; j = 0;` da força bruta joga fora informação de graça: no momento de um mismatch, os `j` caracteres anteriores do texto já são conhecidos — são exatamente os primeiros `j` caracteres do padrão, porque isso é o que acabou de bater. A ideia fundadora do KMP é que esse texto já conhecido pode descartar algumas das próximas posições iniciais antes mesmo de olhar para elas, de forma que o ponteiro do texto nunca precise se mover para trás.

A própria ilustração de Sedgewick e Wayne: busque o padrão `"BAAAAAAAAA"` (um `B` seguido de nove `A`s) sobre um alfabeto de dois caracteres, e suponha que cinco caracteres batam antes de um mismatch no sexto. Nesse ponto sabe-se que o texto lê `"BAAAAB"` no ponto do mismatch (cinco `A`s bateram, depois um `B` onde o padrão esperava um `A`). A força bruta retrocederia o ponteiro do texto quatro vezes, tentando de novo posições iniciais que só contêm mais daqueles `A`s já conhecidos — nenhum dos quais pode possivelmente bater com o `B` inicial do padrão. O caractere que de fato está sentado na posição do mismatch, porém, *é* um `B` — exatamente o primeiro caractere do padrão. Então em vez de retroceder o ponteiro do texto de forma alguma, o conserto é simplesmente resetar `j` para 1 (não 0) e continuar movendo `i` para frente. Sem retrocesso, e a busca ainda termina corretamente.

Aquele atalho específico — pular direto para bater com o primeiro caractere do padrão — não generaliza para todo padrão, porque um padrão pode se sobrepor consigo mesmo. Buscar `"AABAAA"` em `"AABAABAAAA"` bate um mismatch na posição 5, mas o ponto de reinício correto é a posição 3, não mais à frente: pular além da posição 3 perderia uma correspondência real. A generalização que o KMP faz é que exatamente até onde é seguro pular — e para qual posição do padrão retomar — depende só do padrão em si, e por isso pode ser calculado uma vez, com antecedência, antes de o texto ser sequer varrido.

### Construindo o DFA: pré-computa uma vez, varre o texto uma vez sem retroceder

O KMP transforma o padrão num pequeno autômato finito determinístico (DFA): um estado por caractere do padrão (mais um estado final "encontrado" M), onde o número do estado é o índice `j` do padrão sendo comparado no momento. Ler um caractere do texto no estado `j` consulta uma tabela de transição `dfa[c][j]` — o estado para o qual ir a seguir — e avança o ponteiro do texto em exatamente um, sempre, seja essa consulta uma correspondência ou um mismatch. `dfa[pat.charAt(j)][j]` é sempre `j + 1` (uma correspondência avança um estado); todo outro caractere faz `dfa[c][j]` apontar para algum estado ≤ j, pré-computado para refletir exatamente quanto do prefixo do padrão os caracteres de texto já conhecidos satisfazem.

```java
public class KMP {
    private final String pat;
    private final int[][] dfa;

    public KMP(String pat) {
        this.pat = pat;
        int M = pat.length();
        int R = 256;
        dfa = new int[R][M];
        dfa[pat.charAt(0)][0] = 1;
        for (int X = 0, j = 1; j < M; j++) {
            for (int c = 0; c < R; c++)
                dfa[c][j] = dfa[c][X];      // copia os casos de mismatch do estado de reinício X
            dfa[pat.charAt(j)][j] = j + 1;  // define o caso de correspondência
            X = dfa[pat.charAt(j)][X];      // atualiza o estado de reinício
        }
    }

    public int search(String txt) {
        int i, j, N = txt.length(), M = pat.length();
        for (i = 0, j = 0; i < N && j < M; i++)
            j = dfa[txt.charAt(i)][j];
        if (j == M) return i - M; // encontrado
        else return N;            // não encontrado
    }
}
```

A construção é a parte sutil. Cada estado `X` rastreado durante a construção é o estado em que o DFA *cairia* se um mismatch acontecesse bem na coluna `j` e a busca precisasse reiniciar — o truque é que `X` só depende das posições do padrão antes de `j`, que já foram construídas, então `dfa[c][j]` pode simplesmente copiar `dfa[c][X]` para todo caractere `c` de mismatch, e então sobrescrever o único caractere de correspondência com `j + 1`. Para o padrão `"ABABAC"`, isso produz:

```
j:              0   1   2   3   4   5
pat.charAt(j):  A   B   A   B   A   C
dfa['A'][j]:    1   1   3   1   5   1
dfa['B'][j]:    0   2   0   4   0   4
dfa['C'][j]:    0   0   0   0   0   6
```

Uma vez que `dfa[][]` está construído, `search()` nunca mais inspeciona `i - 1` — ele lê cada caractere do texto exatamente uma vez e move `j` dentro da tabela. Proposição N de Sedgewick e Wayne: o KMP acessa no máximo M + N caracteres no total para buscar um padrão de comprimento M num texto de comprimento N — O(M) para acessar cada caractere do padrão ao construir o DFA, e O(N) para varrer o texto uma vez, uma garantia real de pior caso, não uma de caso médio. O custo de construir a própria tabela é O(MR), onde R é o tamanho do alfabeto, já que cada uma das M colunas copia R entradas.

## Trade-offs

- **A força bruta é simples, amigável ao cache, e tipicamente ~1.1N comparações — mas O(NM) em entrada adversarial ou auto-repetitiva** (sequências longas de um caractere repetido tanto no padrão quanto no texto, como mostrado acima). Não é só um brinquedo de livro-texto: Sedgewick e Wayne observam que o próprio `String.indexOf()` do Java usa busca por força bruta, porque o caso comum é rápido o suficiente para que a contabilidade extra que KMP ou Boyer-Moore exigem raramente se pague em código de biblioteca de propósito geral.
- **O KMP troca tempo e espaço de pré-processamento por uma garantia de pior caso.** O DFA completo custa O(MR) de tempo e espaço para construir (uma tabela de M colunas e R linhas), o que é memória extra real que a força bruta nunca precisa — e na prática o ganho de velocidade sobre a força bruta raramente importa, porque poucas aplicações reais buscam um padrão altamente auto-repetitivo num texto altamente auto-repetitivo. O que o KMP garante incondicionalmente é que o ponteiro do texto nunca se move para trás, o que importa muito mais que o ganho bruto de velocidade sempre que a entrada é um stream que não pode ser rebobinado.
- **O Boyer-Moore varre o padrão da direita para a esquerda e costuma ser mais rápido na prática, mas com um pior caso diferente.** Sua heurística de caractere com mismatch usa uma tabela `right[]` — para cada caractere, sua posição mais à direita no padrão — para às vezes pular várias posições de texto de uma vez num único mismatch, em vez de avançar de uma em uma. Em texto típico parecido com inglês isso dá ~N/M comparações de caractere, sublinear no comprimento do padrão, motivo pelo qual muitos editores de texto usam Boyer-Moore. Mas a versão simples da heurística de caractere com mismatch (diferente do KMP) não tem garantia linear de pior caso — Sedgewick e Wayne observam que ela ainda pode levar tempo proporcional a NM; só o algoritmo Boyer-Moore completo, que adiciona uma tabela estilo KMP para as auto-sobreposições do padrão, restaura uma garantia de tempo linear.

## Documentation Links

- Robert Sedgewick, Kevin Wayne, *Algorithms*, 4ª Edição (Addison-Wesley, 2011) — Seção 5.3 "Substring Search", pp. 758-786 — book
- Cormen, Leiserson, Rivest, Stein, *Introduction to Algorithms*, 4ª Edição (MIT Press, 2022) — Capítulo 32 "String Matching", pp. 957-1002 — book
- [Princeton Algorithms, 4th Ed. — Substring Search (companion site)](https://algs4.cs.princeton.edu/53substring/) — doc
- [String — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/String.html) — doc
