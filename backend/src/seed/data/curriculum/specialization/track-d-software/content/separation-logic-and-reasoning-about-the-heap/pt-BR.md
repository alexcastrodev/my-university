---
version: 1.0
updatedAt: 2026-10-20
title: "Lógica de Separação e Raciocínio sobre o Heap"
summary: "A lógica de Hoare falha quando ponteiros têm alias, porque qualquer asserção sobre uma célula pode ser invalidada por uma escrita através de outro nome. A lógica de separação acrescenta uma conjunção separadora P * Q, que significa que P e Q valem em partes disjuntas do heap, e uma regra de frame que estende uma prova sobre um footprint pequeno a qualquer heap maior; é a base do Infer, do VeriFast, do Viper e da prova do RustBelt."
---
## Objetivos de Aprendizagem

- Explicar por que a lógica de Hoare escala mal para programas com ponteiros que têm alias, e como o raciocínio local com um footprint resolve isso.
- Ler e escrever asserções de heap: `emp`, o points-to $x \mapsto v$ e a conjunção separadora $P \ast Q$ com o seu significado de disjunção.
- Enunciar os pequenos axiomas das operações de heap e a regra de frame, e usá-los para verificar um programa curto com ponteiros.
- Definir um predicado indutivo para listas encadeadas, e explicar como a bi-abdução do Infer e a propriedade do Rust se relacionam com a lógica de separação.

## Contexto e Motivação

`ai-theory/formal-methods` desenvolveu a lógica de Hoare: triplas $\{P\}\ C\ \{Q\}$, regras para atribuição, sequência, condicionais e laços com invariantes. Essa lógica funciona bem para programas cujas variáveis são independentes. Ela se quebra em programas com ponteiros: se `x` e `y` podem apontar para a mesma célula, então `{x.f = 0} y.f := 1 {x.f = 0}` não é válida, e toda prova sobre `x` precisa ser reconferida contra toda escrita através de qualquer outro ponteiro, com condições explícitas de não-aliasing para cada par. As condições crescem quadraticamente com o número de ponteiros e afogam a prova.

John Reynolds, Peter O'Hearn, Samin Ishtiaq e Hongseok Yang desenvolveram a **lógica de separação** por volta de 2000 a 2002, uma extensão da lógica de Hoare cujas asserções descrevem pedaços do heap e dizem quais pedaços são disjuntos. Ela é a base do analisador Infer da Meta, dos verificadores VeriFast e Viper, do framework Iris em que a prova do RustBelt foi feita e de código de sistemas verificado em assistentes de prova. O artigo de O'Hearn na CACM e o artigo de Reynolds no LICS 2002 são as introduções padrão.

## Teoria Central

### Estados e asserções de heap

Um estado de programa é um **store** (variáveis para valores) junto com um **heap**, um mapa parcial finito de endereços para valores. As asserções da lógica de separação descrevem o heap:

- $\text{emp}$: o heap é vazio.
- $e \mapsto v$: o heap contém exatamente uma célula, no endereço $e$, guardando $v$. A notação $x \mapsto \_$ significa "algum valor".
- $P \ast Q$ (**conjunção separadora**): o heap pode ser dividido em duas partes com endereços **disjuntos**, uma satisfazendo $P$ e a outra $Q$. Formalmente, $h \models P \ast Q$ sse $h = h_1 \uplus h_2$ com $h_1$ e $h_2$ disjuntos, $h_1 \models P$ e $h_2 \models Q$.
- $P \mathrel{-\!\!\ast} Q$ (a **varinha mágica**): estender o heap com qualquer parte disjunta que satisfaça $P$ produz um heap que satisfaz $Q$. É usada em algumas provas e ignorada aqui.
- Fatos puros como $x = y$ ou $x \neq \text{nil}$, que não dependem do heap.

A propriedade-chave: $x \mapsto 1 \ast y \mapsto 2$ **implica** $x \neq y$, porque uma célula não pode ser dividida em duas partes disjuntas. A disjunção está embutida no conectivo, em vez de ser uma condição lateral.

### Triplas e o footprint

Uma tripla da lógica de separação $\{P\}\ C\ \{Q\}$ é lida de forma **que evita falhas**: se $P$ vale antes de $C$ rodar, então $C$ não acessa nenhum endereço fora do heap descrito por $P$ (não falha) e $Q$ vale depois. $P$ portanto descreve o **footprint** de $C$: exatamente a memória de que ele precisa. As regras para atribuições, sequência, condicionais e laços são as da lógica de Hoare.

### Pequenos axiomas e a regra de frame

Os comandos de heap têm especificações que mencionam apenas a célula que tocam:

$$\{x \mapsto \_\}\ [x] := v\ \{x \mapsto v\} \qquad \{\text{emp}\}\ x := \text{alloc}()\ \{x \mapsto \_\} \qquad \{x \mapsto \_\}\ \text{dispose}(x)\ \{\text{emp}\}$$

e uma leitura $y := [x]$ tem $\{x \mapsto v\}\ y := [x]\ \{x \mapsto v \wedge y = v\}$. A regra que torna essas especificações pequenas utilizáveis é a **regra de frame**:

$$\frac{\{P\}\ C\ \{Q\}}{\{P \ast R\}\ C\ \{Q \ast R\}} \quad \text{se } C \text{ não modifica nenhuma variável livre em } R$$

Se $C$ funciona corretamente no heap pequeno $P$, funciona em qualquer heap maior $P \ast R$ e deixa o resto $R$ intocado. Isso é **raciocínio local**: provar uma especificação sobre o footprint uma vez e reutilizá-la em todo contexto. O aliasing é tratado pela lógica, não à mão.

### Predicados indutivos para estruturas de dados

Formas como listas e árvores são definidas por predicados recursivos. Um segmento de lista de $x$ até $y$:

$$\text{ls}(x, y) \;\triangleq\; (x = y \wedge \text{emp}) \;\vee\; \exists v, z.\ x \mapsto (v, z) \ast \text{ls}(z, y)$$

e uma lista completa é $\text{list}(x) \triangleq \text{ls}(x, \text{nil})$. O $\ast$ no caso recursivo diz que a célula da cabeça e o resto da lista ocupam memória disjunta, então a lista não tem ciclo nem compartilhamento. Invariantes de laço para código que processa listas são escritos com esses predicados.

### Concorrência e ferramentas

Para duas threads trabalhando em memória disjunta, a **lógica de separação concorrente** (O'Hearn, Brookes, 2004) dá uma regra simples: de $\{P_1\}\ C_1\ \{Q_1\}$ e $\{P_2\}\ C_2\ \{Q_2\}$ derivar $\{P_1 \ast P_2\}\ C_1 \parallel C_2\ \{Q_1 \ast Q_2\}$. A ausência de data races decorre da disjunção. A propriedade de uma célula também pode ser transferida para ou de um lock.

As ferramentas se constroem sobre isso de maneiras diferentes. O **Infer** (Meta) introduziu a **bi-abdução** em escala: dado o corpo de um procedimento, ele infere uma pré-condição (o *anti-frame*, a memória de que o procedimento precisa e que o chamador deve fornecer) e uma pós-condição, mais o *frame* que fica intocado. Cada procedimento ganha um resumo que é reutilizado nos seus pontos de chamada, o que torna a análise composicional e rápida o bastante para rodar sobre mudanças de código. O seu checker atual, o Pulse, mantém o mesmo projeto composicional e acha dereferências nulas, uso após liberação e vazamentos em C, C++, Objective-C e Java. **VeriFast** e **Viper** são verificadores em que o usuário anota o código com especificações da lógica de separação, e a ferramenta Prusti usa o Viper para Rust. O **Iris** embute a lógica de separação concorrente de ordem superior no assistente de prova Coq.

### Relação com tipos de propriedade

Um points-to $x \mapsto v$ diz que a thread corrente é *dona* da célula em $x$, e $\ast$ diz que duas coisas possuídas são disjuntas. Essa é a lógica por trás dos moves de dono único do Rust: entregar um valor é abrir mão da sua asserção. As **permissões fracionárias** (Boyland) a refinam: $x \mapsto_{1/2} v \ast x \mapsto_{1/2} v$ é acesso compartilhado somente de leitura, e só a propriedade total $x \mapsto_1 v$ permite escrita, que é a regra "vários leitores ou um escritor" do conceito anterior sobre o borrow checker expressa numa lógica.

## Exemplos Resolvidos

### Exemplo 1: por que a regra de frame elimina condições laterais de aliasing

**Problema:** Mostrar que `[x] := 1` deixa uma segunda célula `y` inalterada, sem uma condição lateral `x ≠ y` escrita à mão.

**Solução:** O pequeno axioma dá $\{x \mapsto 0\}\ [x] := 1\ \{x \mapsto 1\}$. Aplique a regra de frame com $R = y \mapsto 9$ (nenhuma variável é modificada pelo comando, então a condição lateral vale): $\{x \mapsto 0 \ast y \mapsto 9\}\ [x] := 1\ \{x \mapsto 1 \ast y \mapsto 9\}$. A pré-condição já implica $x \neq y$, porque $\ast$ exige células disjuntas. A pós-condição diz que `y` ainda guarda 9. Se em vez disso o chamador passar `x` e `y` que podem ser a mesma célula, a pré-condição $x \mapsto 0 \ast y \mapsto 9$ simplesmente não é satisfeita por aquele heap, e a verificação da chamada falha.

### Exemplo 2: liberando uma lista encadeada

**Problema:** Verificar que o laço libera todo nó e deixa o heap vazio.

```text
// {list(x)}
while (x != nil) {
    t := x.next;       // lê o ponteiro next do nó em x
    dispose(x);        // libera o nó
    x := t;
}
// {emp}
```

**Solução:** Tome o invariante $\text{list}(x)$. Na entrada ele vale. Dentro do laço $x \neq \text{nil}$, então desdobrar o segundo ramo da disjunção dá $\exists v, t.\ x \mapsto (v, t) \ast \text{list}(t)$. A leitura dá a $t$ o ponteiro seguinte, `dispose` consome a célula $x \mapsto \_$ e deixa $\text{list}(t)$ pela regra de frame, e a atribuição `x := t` restabelece $\text{list}(x)$. Na saída $x = \text{nil}$, então $\text{list}(x)$ se desdobra em $\text{emp}$. A prova também exclui um double free: depois de `dispose(x)` a asserção daquela célula some, então um segundo `dispose` dela não teria footprint sobre o qual rodar e falharia na verificação, e uma lista com ciclo nem satisfaria $\text{list}(x)$ para começar.

### Exemplo 3: bi-abdução em um método

**Problema:** O que uma análise no estilo do Infer infere para `void setVal(Node n) { n.next.val = 1; }`?

**Solução:** Executar `n.next.val = 1` a partir de uma suposição vazia falha: precisa ler o campo `next` de `n` e escrever o campo `val` do nó para o qual ele aponta. A abdução registra esses recursos faltantes como a pré-condição inferida: $n \mapsto \{\text{next}: m\} \ast m \mapsto \{\text{val}: \_\}$ para algum `m`. A pós-condição é $n \mapsto \{\text{next}: m\} \ast m \mapsto \{\text{val}: 1\}$. Esse resumo é guardado. Num ponto de chamada em que se sabe que o argumento tem `next == null`, o chamador não consegue fornecer $m \mapsto \{\text{val}: \_\}$ porque não existe nó `m`, então a análise reporta uma possível dereferência de ponteiro nulo ali, sem reanalisar `setVal`. Qualquer parte do heap do chamador não mencionada no resumo é o *frame*, preservado pela regra de frame.

## Equívocos Comuns e Armadilhas

- **"$P \ast Q$ é só $P \wedge Q$ para variáveis diferentes."** $P \wedge Q$ diz que os dois valem para o *mesmo* heap. $P \ast Q$ diz que valem para *partes disjuntas* do heap, o que também dá não-aliasing.
- **"A regra de frame é sempre aplicável."** Ela exige a condição lateral de que o comando não modifica nenhuma variável livre no frame $R$. O conteúdo do heap é protegido por $\ast$, mas as variáveis não.
- **"Lógica de separação é uma ferramenta só para C."** A lógica se aplica a qualquer linguagem com estado mutável compartilhado: Java e Objective-C no Infer, Rust no RustBelt e no Prusti, e estruturas de dados concorrentes no Iris.
- **"O Rust torna a lógica de separação desnecessária."** O borrow checker do Rust é uma instância fixa e automática das suas ideias (propriedade, disjunção). A lógica de separação é o cenário geral em que essa instância, e o código `unsafe` por baixo dela, é provada correta.

## Resumo

A lógica de Hoare precisa de condições laterais de não-aliasing para cada par de ponteiros, o que não escala. A lógica de separação acrescenta asserções de heap, o points-to $x \mapsto v$ e a conjunção separadora $P \ast Q$ para partes disjuntas, com triplas que evitam falhas e descrevem o footprint de um comando. Pequenos axiomas para comandos de heap mais a regra de frame dão raciocínio local: prove uma especificação sobre o footprint e estenda-a a qualquer contexto. Predicados indutivos como $\text{list}(x)$ descrevem estruturas de dados, a lógica de separação concorrente dá uma regra para threads em memória disjunta, e a bi-abdução no Infer infere footprints automaticamente. Tipos de propriedade são uma forma restrita e automática da mesma ideia. O próximo conceito passa de provar para testar, em que as entradas do programa são geradas em vez de raciocinadas: o fuzzing guiado por cobertura.

## Documentation Links

- [Reynolds: Separation Logic: A Logic for Shared Mutable Data Structures (LICS 2002)](https://www.cs.cmu.edu/~jcr/seplogic.pdf): doc
- [O'Hearn: Separation Logic (Communications of the ACM, 2019)](https://dl.acm.org/doi/10.1145/3211968): doc
- [Infer documentation: Separation Logic and Bi-abduction](https://fbinfer.com/docs/separation-logic-and-bi-abduction): doc
- [Software Foundations, Volume 6: Separation Logic Foundations](https://softwarefoundations.cis.upenn.edu/slf-current/index.html): doc
