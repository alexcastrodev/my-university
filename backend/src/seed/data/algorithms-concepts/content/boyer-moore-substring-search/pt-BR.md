---
version: 1.0
updatedAt: 2026-08-13
title: "Boyer-Moore: Varredura da Direita para a Esquerda e Busca de Substring Sublinear"
description: "Como varrer o padrão da direita para a esquerda e pré-computar uma tabela de salto por caractere de discordância permite que Boyer-Moore deslize o padrão para além de vários caracteres do texto em uma única discordância — muitas vezes sublinear na prática (~N/M comparações, pela Propriedade O de Sedgewick e Wayne) — ao custo da garantia incondicional de pior caso O(N+M) do KMP."
---
## Objetivo

Retome de onde o concept de Knuth-Morris-Pratt parou: ele varre o padrão da esquerda para a direita e garante O(N+M), mas sinalizou brevemente Boyer-Moore como a alternativa "varre da direita para a esquerda, pode pular várias posições, mais rápido na prática" sem se aprofundar. Este concept entrega essa profundidade — a heurística do caractere de discordância que permite a Boyer-Moore deslizar o padrão para além de vários caracteres do texto em uma única discordância, por que isso o torna *sublinear* em texto típico (ele pode examinar menos de N caracteres no total, algo que força bruta e KMP nunca conseguem fazer), e o custo honesto: a versão simplificada coberta aqui dá esse ganho de velocidade em troca de perder a garantia de pior caso do KMP.

## Casos de Uso

- Busca estilo `grep` em linha de comando e o recurso "localizar no arquivo" de editores de texto, onde os saltos práticos grandes de Boyer-Moore em texto parecido com inglês comum o tornam o motor tradicional de escolha em vez de força bruta ou KMP.
- Varredura de assinatura de vírus/malware contra arquivos grandes ou imagens de memória, onde uma assinatura de byte curta e fixa é buscada repetidamente e o comportamento sublinear no caso típico (examinando apenas uma fração dos bytes) importa em escala.
- Qualquer busca única sobre um texto que você já mantém inteiramente em memória (um documento carregado, um buffer, um array de bytes) — a varredura da direita para a esquerda de Boyer-Moore precisa olhar à frente dentro da janela de alinhamento atual, então se encaixa em dados que você pode indexar livremente, em vez de um stream que só pode ser lido uma vez.

## Aprofundamento

### Varredura da direita para a esquerda e a heurística do caractere de discordância

Força bruta e KMP ambos varrem o padrão da esquerda para a direita. A ideia central de Boyer-Moore é varrê-lo da direita para a esquerda: comparar primeiro o *último* caractere do padrão contra o texto, depois trabalhar para trás. Varrer nessa direção é o que torna saltos grandes possíveis — uma discordância na primeira comparação (a mais à direita) informa sobre um caractere de texto que o padrão ainda nem confirmou combinar com nada, então não há correspondência parcial acumulada para preservar. Onde esse caractere de texto discordante se situa em relação ao próprio conteúdo do padrão decide o quão longe é seguro deslizar.

Para tomar essa decisão em tempo constante, Boyer-Moore pré-computa uma tabela `right[c]` — para todo caractere `c` no alfabeto, o índice de sua ocorrência mais à direita no padrão, ou -1 se `c` nunca aparece no padrão. Esse caso -1 é de onde vêm os saltos dramáticos. Pegue o padrão `"ABCD"` (M = 4, então `right['A']=0, right['B']=1, right['C']=2, right['D']=3`, tudo o mais -1) alinhado na posição de texto i = 3 contra um texto que lê `...ZABYZW...` a partir dali:

```
texto:      X  Y  Z  A  B  X  Y  Z  W  ...
índice:     0  1  2  3  4  5  6  7  8
padrão (i=3):        A  B  C  D
j:                     0  1  2  3
```

A varredura começa na posição mais à direita do padrão, j = 3: `pat[3] = 'D'` contra `txt[3+3] = txt[6] = 'Y'`. Discordância. Como `'Y'` nunca ocorre em `"ABCD"`, `right['Y'] = -1`, e deslizar o padrão por qualquer coisa menor que seu comprimento total ainda deixaria algum caractere do padrão sobre esse mesmo `'Y'` — o que nunca pode dar match, porque `'Y'` não está no padrão de forma alguma. Então o padrão inteiro pode saltar por cima dele com segurança: `skip = j - right['Y'] = 3 - (-1) = 4`, pousando a próxima tentativa em i = 3 + 4 = 7. Quatro caracteres de texto (posições 3 a 6) foram eliminados de consideração depois de examinar apenas um deles — o tipo de salto que força bruta e KMP jamais conseguem fazer estruturalmente, já que ambos estão comprometidos a avançar o ponteiro do texto uma posição de cada vez.

### A tabela de salto, o caso dentro-do-padrão, e nunca saltar para trás

Construir `right[]` é uma única passada da esquerda para a direita sobre o padrão: inicialize toda entrada em -1, depois para cada posição `j` do padrão, de 0 a M-1, registre `right[pat.charAt(j)] = j`. Como posições posteriores sobrescrevem as anteriores, cada caractere acaba mapeado para sua ocorrência *mais à direita* automaticamente. Isso custa tempo O(M + R) e espaço O(R), onde R é o tamanho do alfabeto — mais barato de construir do que o DFA O(MR) do KMP, e usando apenas O(R) de espaço extra em vez de O(MR).

```java
public class BoyerMoore {
    private final int[] right;
    private final String pat;

    public BoyerMoore(String pat) {
        this.pat = pat;
        int M = pat.length();
        int R = 256;
        right = new int[R];
        for (int c = 0; c < R; c++)
            right[c] = -1;                    // -1 para caracteres que não estão no padrão
        for (int j = 0; j < M; j++)
            right[pat.charAt(j)] = j;         // a ocorrência mais à direita vence
    }

    public int search(String txt) {
        int N = txt.length();
        int M = pat.length();
        int skip;
        for (int i = 0; i <= N - M; i += skip) {
            skip = 0;
            for (int j = M - 1; j >= 0; j--) {
                if (pat.charAt(j) != txt.charAt(i + j)) {
                    skip = j - right[txt.charAt(i + j)];
                    if (skip < 1) skip = 1;   // garante progresso para frente
                    break;
                }
            }
            if (skip == 0) return i;          // padrão inteiro combinou
        }
        return N;                             // não encontrado
    }
}
```

`right[]` também unifica o caso em que o caractere discordante *aparece* no padrão — a mesma fórmula, `skip = j - right[c]`, trata disso. Se a ocorrência mais à direita do caractere de texto discordante no padrão fica à esquerda da posição de comparação atual `j`, o padrão desliza para a frente para alinhar essa ocorrência com o ponto de discordância, só que por uma quantidade menor que um salto de comprimento total. Usando o padrão `"ABAB"` (`right['A'] = 2, right['B'] = 3`, construído da mesma forma — `j` posterior sobrescreve `j` anterior), suponha que uma varredura chegue a `j = 1` (`pat[1] = 'B'`) e o caractere de texto ali seja `'A'`: `skip = j - right['A'] = 1 - 2 = -1`. Negativo — a fórmula ingênua quer deslizar o padrão *para trás*, porque a ocorrência mais à direita de `'A'` no padrão (índice 2) fica à direita de onde a discordância aconteceu (índice 1); parte do padrão já varrido como match teria que ser desfeita. Isso nunca é permitido acontecer: `search()` trava `skip` em 1 sempre que o valor calculado é menor que 1, o que garante que o laço externo sempre faça progresso para frente, independente de como o caractere discordante se sobrepõe ao padrão.

### Trace resolvido: um salto dramático, verificado à mão

Busque pelo padrão `"ABCD"` (M = 4) no texto `"XYZABXYZWABCDXYZAB"` (N = 18). O match real fica em i = 9 (`text[9..12] = "ABCD"`); traçar o algoritmo à mão confirma que Boyer-Moore o alcança depois de apenas três alinhamentos falhos — incluindo um salto de 4 posições, o salto máximo possível para este padrão:

- **i = 0**: `j=3`, `pat[3]='D'` vs `txt[3]='A'` — discordância. `'A'` está no padrão no índice 0, então `skip = 3 - 0 = 3` → próxima tentativa em i = 3.
- **i = 3**: `j=3`, `pat[3]='D'` vs `txt[6]='Y'` — discordância. `'Y'` não está no padrão de forma alguma, então `skip = 3 - (-1) = 4` → próxima tentativa em i = 7. Esse é o caso dramático: o comprimento total do padrão saltado em um único passo.
- **i = 7**: `j=3`, `pat[3]='D'` vs `txt[10]='B'` — discordância. `'B'` está no padrão no índice 1, então `skip = 3 - 1 = 2` → próxima tentativa em i = 9.
- **i = 9**: `j=3,2,1,0` todos combinam (`txt[9..12] = "ABCD"`) → `search()` retorna i = 9.

Total: 7 comparações de caractere (1 cada para os 3 alinhamentos falhos, 4 para o bem-sucedido) para buscar em 18 caracteres de texto — força bruta precisaria de até 4 comparações em várias das 15 posições de partida possíveis para descartar cada uma.

Este é um texto fixo sendo varrido por um padrão deslizante, não uma transformação de array in-place, então não se encaixa perfeitamente no modelo baseado em swap do motor de moves da mesma forma que a ordenação de um array. Mas tratar o texto como a única linha e usar `mark` para destacar a posição de texto sendo comparada em cada passo reproduz o trace fielmente — a mesma abordagem que o próprio bloco viz do concept de KMP usa para seu trace de força bruta:

```viz
type: moves
mark 3 | Alinha i=0 (padrão "ABCD" sob text[0..3]). Varredura da direita para a esquerda: j=3, pat[3]='D' vs txt[3]='A' — discordância na primeira comparação.
mark 6 | 'A' ocorre no padrão no índice 0, então skip = j - right['A'] = 3 - 0 = 3, deslizando para i=3. Novo alinhamento: j=3, pat[3]='D' vs txt[6]='Y' — discordância.
mark 10 | 'Y' nunca aparece em "ABCD" (right['Y'] = -1), então skip = j - (-1) = 3 - (-1) = 4 — o padrão inteiro salta por cima dele, deslizando para i=7. Novo alinhamento: j=3, pat[3]='D' vs txt[10]='B' — discordância.
mark 12 | 'B' ocorre no padrão no índice 1, então skip = j - right['B'] = 3 - 1 = 2, deslizando para i=9. Novo alinhamento: j=3, pat[3]='D' vs txt[12]='D' — match, continua varrendo da direita para a esquerda.
mark 11 | j=2: pat[2]='C' vs txt[11]='C' — match.
mark 10 | j=1: pat[1]='B' vs txt[10]='B' — match.
mark 9 | j=0: pat[0]='A' vs txt[9]='A' — match. Todas as quatro posições verificadas: search() retorna i=9, após 7 comparações de caractere no total.
---
X
Y
Z
A
B
X
Y
Z
W
A
B
C
D
X
Y
Z
A
B
```

### Sublinear em texto típico, mas não seguro no pior caso

A Propriedade O de Sedgewick e Wayne enuncia o ganho com precisão: em entradas típicas, a heurística do caractere de discordância de Boyer-Moore usa ~N/M comparações de caractere para buscar um texto de comprimento N por um padrão de comprimento M — *sublinear*, porque a maioria dos caracteres do alfabeto simplesmente não aparece em um padrão curto, então quase toda discordância dispara um salto de comprimento M completo, da mesma forma que o salto dramático do trace resolvido. Isso é uma classe de garantia genuinamente diferente de qualquer coisa que força bruta ou KMP possam oferecer, já que ambos estão estruturalmente comprometidos a examinar todo caractere de texto pelo menos uma vez.

O custo honesto da versão *simplificada* coberta aqui — só a heurística do caractere de discordância, sem a regra adicional de "bom sufixo forte" de Sedgewick — é que ela não tem garantia linear de pior caso. Ainda pode degradar para O(NM) em entrada adversarial ou altamente repetitiva. Concretamente: padrão `"BAAAA"` (M = 5, então `right['A'] = 4`, `right['B'] = 0`) contra um texto de nada além de caracteres `'A'` (digamos 12 deles, nenhum `'B'` em lugar algum — o padrão nunca é encontrado). Em cada um dos ~8 alinhamentos possíveis, a varredura combina todos os quatro `'A'`s finais (`j=4` até `j=1`) antes finalmente discordar em `j=0` (`pat[0]='B'` vs `txt[i]='A'`) — M comparações completas todas as vezes. Pior, o skip calculado ali é `skip = 0 - right['A'] = 0 - 4 = -4`, travado em 1: nenhum salto significativo. ~8 tentativas × 5 comparações ≈ 40 comparações para buscar em 12 caracteres — proporcional a NM, não melhor que o próprio pior caso de força bruta.

Essa é exatamente a troca que o DFA do concept irmão de KMP é construído para evitar: a Proposição N do KMP garante no máximo M + N acessos a caractere *independente da entrada*, por construção, porque seu autômato já absorveu toda auto-sobreposição possível do padrão antecipadamente. A heurística só-caractere-discordante de Boyer-Moore não faz essa promessa — ela vence facilmente em texto típico, de baixa auto-sobreposição (prosa em inglês, código-fonte, a maioria dos alvos de busca do mundo real) e perde feio em entrada autorrepetitiva. Sedgewick e Wayne apontam que o algoritmo Boyer-Moore *completo* adiciona uma segunda tabela, ao estilo KMP, capturando as auto-sobreposições do padrão (a regra do "bom sufixo forte") e de fato restaura uma garantia de tempo linear de pior caso — mas essa construção é apenas mencionada de passagem no texto-fonte, não implementada, porque a heurística do caractere de discordância sozinha é o que controla o desempenho em aplicações práticas típicas.

## Trade-offs

- **Saltos práticos grandes, sem garantia de pior caso (esta versão).** A heurística do caractere de discordância sozinha dá ~N/M comparações em texto típico, mas pode degradar para O(NM) em entrada adversarial ou autorrepetitiva, como mostrado acima — diferente do O(N+M) incondicional do KMP. O algoritmo completo (adicionando a tabela de bom sufixo forte) resolve isso, ao custo de mais pré-processamento e mais memória do que qualquer uma das versões precisa hoje.
- **Pré-processamento barato, tabela pequena.** `right[]` custa tempo O(M + R) e espaço O(R) para construir — menos setup e menos memória do que o DFA O(MR) do KMP, já que só registra um índice mais à direita por caractere do alfabeto, em vez de uma tabela de transição completa por estado.
- **Exige lookahead dentro da janela atual — nenhuma garantia de streaming.** Diferente do KMP, que nunca move seu ponteiro de texto para trás e consegue processar um stream caractere por caractere, a varredura da direita para a esquerda de Boyer-Moore precisa ler `txt.charAt(i+j)` para `j` até M-1 antes mesmo de começar, e uma tentativa falha relê caracteres dentro da nova janela. Isso é tranquilo para texto já mantido em memória, mas exclui aquele mesmo processamento de stream não bufferizado, em passada única, que torna KMP atraente para entrada de rede ou `stdin`.

## Documentation Links

- Robert Sedgewick, Kevin Wayne, *Algorithms*, 4th Edition (Addison-Wesley, 2011) — Section 5.3 "Substring Search", Boyer-Moore (mismatched-character heuristic), pp. 769-774 — book
- [Princeton Algorithms, 4th Ed. — Substring Search (companion site)](https://algs4.cs.princeton.edu/53substring/) — doc
- [String — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/String.html) — doc
