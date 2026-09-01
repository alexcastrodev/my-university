---
version: 1.0
updatedAt: 2026-08-13
title: "Algoritmos Greedy: Seleção de Atividades e Por Que a Escolha Greedy Certa Importa"
description: "Resolve o problema de seleção de atividades (agendar o maior número possível de atividades sem sobreposição em um recurso compartilhado) com a regra greedy do menor tempo de término, prova por que essa regra específica é ótima, e mostra um contraexemplo verificado onde uma regra alternativa plausível (menor duração primeiro) falha — contrastado com a formulação em programação dinâmica do mesmo problema."
---
## Objetivo

Entenda o problema de seleção de atividades — agendar o maior conjunto possível de atividades sem sobreposição em um único recurso compartilhado — e a regra greedy específica (menor tempo de término primeiro) que o resolve de forma comprovadamente ótima, contrastada com regras greedy que soam plausíveis mas não funcionam, e com a abordagem de programação dinâmica que o mesmo problema poderia usar mas não precisa.

## Casos de Uso

- Reservar uma única sala de conferência, quadra ou equipamento compartilhado para o maior número possível de reservas sem sobreposição.
- Agendar uma máquina, core de CPU ou lock exclusivo para maximizar o número de jobs compatíveis que ele consegue rodar em sequência.
- Reconhecer, em uma entrevista ou discussão de design, quando um problema com cara de agendamento é na verdade um problema greedy disfarçado — e quando um pequeno detalhe (por exemplo, atividades carregando *valores* diferentes) quebra a regra greedy e empurra de volta para programação dinâmica.

## Aprofundamento

### O problema de seleção de atividades e greedy-por-menor-tempo-de-término

Dadas `n` atividades, cada uma com um tempo de início `s[i]` e um tempo de término `f[i]`, a atividade `i` ocupa o intervalo semiaberto `[s[i], f[i])`. Duas atividades são *compatíveis* se seus intervalos não se sobrepõem — ou seja, `a[i]` e `a[j]` são compatíveis se `s[i] >= f[j]` ou `s[j] >= f[i]`. O objetivo: escolher o maior subconjunto possível de atividades mutuamente compatíveis.

O algoritmo greedy ordena por tempo de término e depois pega repetidamente a próxima atividade cujo tempo de início seja igual ou posterior ao tempo de término da atividade mais recentemente selecionada:

```java
record Activity(String name, int start, int finish) {}

static List<Activity> selectActivities(List<Activity> activities) {
    List<Activity> sorted = new ArrayList<>(activities);
    sorted.sort(Comparator.comparingInt(Activity::finish)); // a única ordenação que torna o resto Θ(n)

    List<Activity> selected = new ArrayList<>();
    int lastFinish = Integer.MIN_VALUE;
    for (Activity a : sorted) {
        if (a.start() >= lastFinish) {   // compatível com toda atividade escolhida até agora
            selected.add(a);
            lastFinish = a.finish();
        }
    }
    return selected;
}
```

Isso é uma tradução direta do `GREEDY-ACTIVITY-SELECTOR(s, f, n)` iterativo do CLRS. Como `lastFinish` sempre rastreia o maior tempo de término entre as atividades selecionadas, checar `a.start() >= lastFinish` já basta para confirmar compatibilidade com *toda* atividade selecionada anteriormente, não só a mais recente — sem precisar reescanear todo o conjunto selecionado.

Exemplo resolvido, sete atividades já ordenadas por tempo de término:

| Atividade | Início | Término | Selecionada? | Por quê |
|---|---|---|---|---|
| A1 | 1 | 4 | Selecionada | menor tempo de término geral — sempre a escolha inicial do greedy |
| A2 | 3 | 5 | Rejeitada | começa em 3, antes de A1 terminar em 4 → sobrepõe A1 |
| A3 | 0 | 6 | Rejeitada | começa em 0, antes de A1 terminar em 4 → sobrepõe A1 |
| A4 | 5 | 7 | Selecionada | começa em 5 ≥ 4 (término de A1) → compatível; `lastFinish` vira 7 |
| A5 | 5 | 9 | Rejeitada | começa em 5, antes de A4 terminar em 7 → sobrepõe A4 |
| A6 | 6 | 10 | Rejeitada | começa em 6, antes de A4 terminar em 7 → sobrepõe A4 |
| A7 | 8 | 11 | Selecionada | começa em 8 ≥ 7 (término de A4) → compatível |

Resultado: `{A1, A4, A7}`, tamanho 3 — o máximo possível para essa instância. Toda atividade rejeitada foi descartada pelo mesmo motivo: seu tempo de início caiu antes do tempo de término da atividade mais recentemente *selecionada*, não necessariamente da mais recentemente *considerada*.

### Por que menor tempo de término é comprovadamente correto

É tentador simplesmente confiar na intuição — "libere o recurso mais cedo, para que mais coisas caibam depois dele" — mas o CLRS de fato prova isso (Teorema 15.1), e vale a pena ter o argumento com precisão, não só como slogan.

Tome qualquer ponto do algoritmo onde ainda resta um subproblema: algum conjunto de atividades ainda disponíveis, ainda não consideradas em pares. Seja `am` aquela, entre elas, com o menor tempo de término. Afirmação: `am` pertence a *algum* subconjunto compatível de tamanho máximo desse conjunto restante.

A prova é um argumento de troca. Tome qualquer solução ótima para esse subproblema, e seja `aj` seu membro que termina mais cedo. Se `aj` já é `am`, terminou. Caso contrário, troque `aj` por `am`: como `am` tem o menor tempo de término de *qualquer coisa* no subproblema, `f(am) <= f(aj)`. Toda outra atividade mantida naquela solução ótima começa em ou depois de `f(aj)` (foi isso que tornou a solução compatível em primeiro lugar), e como `f(am) <= f(aj)`, essas mesmas atividades também começam em ou depois de `f(am)`. Então a troca não quebra nenhuma compatibilidade — e a solução continua do mesmo tamanho, só com `am` no lugar de `aj`. Isso significa que sempre existe uma solução ótima contendo `am`.

A consequência é o que faz o algoritmo funcionar: uma vez feita a escolha greedy, você nunca precisa olhar para trás e reconsiderá-la. A atividade compatível que termina mais cedo sempre libera o recurso para a maior porção possível do restante da linha do tempo, então trocá-la para dentro do que quer que a solução ótima já fosse fazer nunca custa nada — só empata ou ganha.

### Uma regra greedy plausível, mas errada: menor duração primeiro

O CLRS avisa explicitamente (Exercício 15.1-3) que nem toda regra greedy para esse problema funciona, mesmo algumas que soam tão razoáveis quanto "menor tempo de término" — "menor duração primeiro" e "menos conflitos restantes primeiro" são ambas citadas como regras que falham. Aqui está um contraexemplo pequeno e verificado para menor-duração-primeiro:

| Atividade | Início | Término | Duração |
|---|---|---|---|
| X | 0 | 4 | 4 |
| Y | 4 | 8 | 4 |
| Z | 3 | 5 | 2 |

`X` e `Y` são compatíveis entre si (`X` termina exatamente quando `Y` começa, e `s >= f` conta como compatível pela definição de intervalo semiaberto), então `{X, Y}` é um agendamento válido de tamanho 2 — e é ótimo, já que só existem 3 atividades e `Z` conflita com as outras duas.

Um algoritmo greedy que sempre escolhe a atividade restante mais curta escolhe `Z` primeiro (duração 2, menor que a duração 4 de `X` ou `Y`). Mas o intervalo `[3, 5)` de `Z` sobrepõe `[0, 4)` de `X` (`Z` começa em 3, antes de `X` terminar em 4) *e* sobrepõe `[4, 8)` de `Y` (`Z` termina em 5, depois de `Y` começar em 4). Escolher `Z` descarta tanto `X` quanto `Y` em um único movimento, deixando uma resposta final de `{Z}` — tamanho 1, metade do ótimo.

O greedy por menor-tempo-de-término não comete esse erro: ordenado por tempo de término, a ordem é `X` (4), `Z` (5), `Y` (8). Escolhe `X` primeiro, depois checa `Z` (início 3, antes do término 4 de `X` → rejeitada), depois `Y` (início 4, igual ou depois do término 4 de `X` → aceita), chegando corretamente em `{X, Y}`.

O modo de falha é estrutural, não um acaso: uma atividade curta pode estar bem no *meio* de duas atividades mais longas e mutuamente compatíveis, bloqueando as duas de uma vez — a duração sozinha não diz nada sobre quanto da linha do tempo uma atividade bloqueia para as outras.

### Propriedade da escolha greedy, subestrutura ótima e por que DP seria overkill aqui

O CLRS nomeia dois ingredientes que um problema precisa ter para que um algoritmo greedy seja comprovadamente correto:

- **Propriedade da escolha greedy** — uma solução globalmente ótima pode ser alcançada por uma sequência de escolhas localmente melhores, cada uma feita sem revisitar escolhas anteriores e sem esperar pelas soluções de subproblemas. O Teorema 15.1 na seção acima é exatamente a prova de que seleção de atividades tem essa propriedade para "menor tempo de término".
- **Subestrutura ótima** — uma solução ótima para o problema contém soluções ótimas para seus subproblemas. Para seleção de atividades, se `Sk` é o conjunto de atividades que começam não antes do término da atividade mais recentemente escolhida `ak`, então uma solução ótima para o problema inteiro é `ak` mais uma solução ótima para o subproblema `Sk`. Essa é a mesma propriedade em que a programação dinâmica se apoia — greedy e DP se baseiam ambos em subestrutura ótima, e é exatamente por isso que é fácil recorrer à técnica errada.

O CLRS de fato percorre uma formulação DP completa desse mesmo problema antes de introduzir o algoritmo greedy, como contraste deliberado. Defina `c[i,j]` como o tamanho de uma solução ótima restrita a atividades que começam depois de `ai` terminar e terminam antes de `aj` começar:

```
c[i,j] = 0                                      se esse conjunto for vazio
c[i,j] = max( c[i,k] + c[k,j] + 1 )  sobre todo candidato ak nesse conjunto,  caso contrário
```

Essa recorrência está correta — seleção de atividades de fato tem subproblemas sobrepostos, e você *poderia* memoizar ou tabular `c[i,j]` como faria com qualquer problema DP. Mas isso é overhead desnecessário aqui: preencher essa tabela significa comparar todo ponto de divisão candidato `k` em todo subproblema, o que custa muito mais do que a única passada ordenada do algoritmo greedy. Uma vez provada a propriedade da escolha greedy, você já sabe de antemão qual escolha é ótima em cada passo (a compatível que termina mais cedo), então não sobra nada para comparar — sem tabela, sem backtracking, só Θ(n) depois de uma ordenação O(n log n). DP explora; greedy se compromete.

## Trade-offs

- **Greedy só sai barato depois que a prova está feita.** O ganho de tempo de execução — O(n log n) total (dominado pela ordenação), contra uma tabela DP com O(n) subproblemas, cada um varrendo até O(n) pontos de divisão — só existe porque a propriedade da escolha greedy foi provada antes. Pular essa prova e simplesmente tentar uma regra que "parece certa" é como você acaba com o bug de menor-duração-primeiro acima: ele pode passar em testes casuais e ainda assim estar errado em algumas entradas.
- **Greedy se compromete e nunca olha para trás — o que também é seu ponto cego.** O algoritmo nunca reconsidera uma escolha já feita:

  ```java
  // lastFinish só avança — não há caminho de volta para uma decisão anterior
  if (a.start() >= lastFinish) {
      selected.add(a);
      lastFinish = a.finish();   // essa atividade agora está travada, permanentemente
  }
  ```

  Isso é o que o torna rápido, mas também significa que a regra é frágil a mudanças no problema. Adicione um *valor* por atividade e peça o subconjunto compatível de maior valor em vez da maior contagem (Exercício 15.1-5 do CLRS) — o greedy por menor-tempo-de-término deixa de ser garantidamente ótimo, e a versão ponderada do problema precisa de uma solução DP (weighted interval scheduling) em vez disso.
- **Duas propriedades nomeadas são um checklist, não uma garantia de facilidade.** Propriedade da escolha greedy e subestrutura ótima dizem *se* um algoritmo greedy pode existir para um problema, mas provar a propriedade da escolha greedy ainda é trabalho de verdade — geralmente um argumento de troca como o do Teorema 15.1, ajustado à regra específica que você está propondo. Uma regra diferente para o mesmo problema (menos conflitos, menor início) precisa da própria tentativa de prova, e para essas duas regras a tentativa de prova falha, o que só é descoberto tentando construir uma — ou um contraexemplo.

## Documentation Links

- Cormen, Leiserson, Rivest, Stein, *Introduction to Algorithms*, 4ª Edição (MIT Press, 2022) — Capítulo 15 "Greedy Algorithms", Seções 15.1 "An activity-selection problem" e 15.2 "Elements of the greedy strategy", pp. 415-430 — book
