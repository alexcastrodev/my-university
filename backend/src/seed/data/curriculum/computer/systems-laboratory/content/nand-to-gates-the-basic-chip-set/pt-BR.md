---
version: 1.0
updatedAt: 2026-09-12
title: "Laboratório: do NAND às Portas, o Conjunto Básico de Chips"
summary: "NAND como Porta Universal provou, no papel, que toda outra porta pode ser expressa só com NAND; este laboratório é onde essa prova deixa de ser um exercício de álgebra booleana e vira código funcional, compondo uma primitiva NAND em software em AND, OR, NOT, XOR e um multiplexador 2 para 1, cada um verificado contra sua própria tabela verdade, exatamente o primeiro passo, fundamental, da própria sequência de construção de um computador do Nand2Tetris."
---
## Objetivos de Aprendizagem

- Implementar uma primitiva NAND e compô-la em portas NOT, AND, OR e XOR, verificando cada uma contra sua própria tabela verdade completa.
- Implementar um multiplexador 2 para 1 (MUX) a partir das portas acima, e explicar por que um MUX é o componente ao qual toda decisão de lógica de controle posterior deste arco se reduz.
- Projetar um pequeno arcabouço de testes que confere automaticamente a saída de uma porta contra cada linha da sua tabela verdade, em vez de conferir à mão algumas entradas.
- Explicar por que construir portas a partir de uma única primitiva, em vez de tratar AND/OR/NOT como dadas separadamente, importa para o que vem depois neste arco de laboratórios.

## Contexto e Motivação

**NAND como Porta Universal** já fez o argumento teórico: toda outra porta lógica pode ser expressa usando só NAND, um resultado real e matematicamente completo, e não uma curiosidade. Este laboratório é onde essa prova deixa de ser um argumento no papel e vira código que de fato roda, compondo uma única primitiva NAND num pequeno conjunto de chips (NOT, AND, OR, XOR e um multiplexador), cada um verificado mecanicamente contra sua tabela verdade completa. Este é o primeiro laboratório do arco de construção da CPU desta disciplina, e todo laboratório posterior (a ULA no Laboratório 2, o banco de registradores e a RAM no Laboratório 3, a CPU completa no Laboratório 4) é construído inteiramente com as portas montadas aqui, exatamente a sequência que o próprio curso Build a Modern Computer do Nand2Tetris segue.

## Teoria Central

Nada sobre *por que* o NAND é universal é rederivado aqui (esse argumento pertence a `nand-as-a-universal-gate`); este laboratório é a disciplina de transformá-lo em código funcional e testado. Uma porta aqui é modelada de forma simples, como uma função pura de um número fixo de entradas booleanas para uma saída booleana, composta a partir de chamadas a portas mais primitivas, espelhando exatamente como uma linguagem de descrição de hardware real expressa lógica combinacional.

## Exemplos Resolvidos

### Especificação da API

```text
NAND(a: bool, b: bool) -> bool          # a ÚNICA primitiva dada
NOT(a: bool) -> bool                     # construída só com NAND
AND(a: bool, b: bool) -> bool            # construída com NAND/NOT
OR(a: bool, b: bool) -> bool             # construída com NAND/NOT
XOR(a: bool, b: bool) -> bool            # construída com AND/OR/NOT
MUX(a: bool, b: bool, sel: bool) -> bool # devolve a se sel==0, senão b
```

### Passo 1: a única primitiva dada

```python
def NAND(a: bool, b: bool) -> bool:
    return not (a and b)  # o "and"/"not" da própria plataforma aqui fazem o papel
                            # de uma porta NAND real em nível de transistor; toda
                            # OUTRA porta abaixo é construída usando SÓ esta
                            # função, nunca os and/or/not embutidos do Python
```

### Passo 2: NOT e AND, construídas só com NAND

```python
def NOT(a: bool) -> bool:
    return NAND(a, a)  # NAND(a,a) = not(a and a) = not(a)

def AND(a: bool, b: bool) -> bool:
    return NOT(NAND(a, b))  # NAND é "not AND"; aplicar NOT desfaz isso
```

### Passo 3: OR e XOR, compostas a partir do que já existe

```python
def OR(a: bool, b: bool) -> bool:
    return NAND(NOT(a), NOT(b))  # a lei de De Morgan, construída como circuito,
                                    # e não só afirmada como fato de álgebra

def XOR(a: bool, b: bool) -> bool:
    return AND(OR(a, b), NOT(AND(a, b)))  # verdadeiro se e somente se exatamente uma entrada for verdadeira
```

### Passo 4: o multiplexador, o componente ao qual tudo depois se reduz

```python
def MUX(a: bool, b: bool, sel: bool) -> bool:
    return OR(AND(a, NOT(sel)), AND(b, sel))
```

### Passo 5: um arcabouço de testes que confere a tabela verdade COMPLETA, e não alguns casos

```python
def check_truth_table(gate_fn, expected: dict, arity: int):
    import itertools
    for inputs in itertools.product([False, True], repeat=arity):
        got = gate_fn(*inputs)
        want = expected[inputs]
        assert got == want, f"{gate_fn.__name__}{inputs}: got {got}, want {want}"

check_truth_table(XOR, {
    (False, False): False, (False, True): True,
    (True, False): True,   (True, True): False,
}, arity=2)
```

## Equívocos Comuns e Armadilhas

- **"Usar os `and`/`or`/`not` embutidos do Python dentro dessas funções é um atalho inofensivo."** Isso anula o objetivo inteiro: a afirmação do laboratório é que toda porta pode ser expressa só com NAND, e recorrer a uma primitiva diferente e já dada em qualquer ponto da implementação, mesmo uma única vez, quebra essa afirmação em silêncio, já que o código continua passando nos próprios testes enquanto deixa de demonstrar o que deveria demonstrar.
- **"Conferir uma porta em uma ou duas entradas basta antes de passar para a próxima."** A definição de uma porta é sua tabela verdade completa; um bug que só aparece numa combinação de entrada específica e não testada (uma fonte comum de erros reais num OR ou XOR composto à mão) sobrevive sem ser detectado até um laboratório bem posterior, onde é muito mais difícil rastreá-lo até sua origem real.
- **"O multiplexador é só mais uma porta entre várias, sem mais importância que as outras."** Todo laboratório posterior deste arco (a lógica de seleção de operação da ULA, a lógica de habilitação de escrita do banco de registradores, a própria decodificação de instruções da CPU) é construído com multiplexadores escolhendo entre sinais com base num bit de controle; entendê-lo aqui, na sua forma mais simples, rende frutos diretamente em todo laboratório seguinte.

## Resumo

Este laboratório transforma a prova teórica de `nand-as-a-universal-gate` em código funcional e testado individualmente: uma única primitiva NAND composta passo a passo em NOT, AND, OR, XOR e um multiplexador, cada um verificado contra sua tabela verdade completa, e não conferido por amostragem. Esse conjunto de chips é a base literal sobre a qual todo laboratório posterior deste arco se constrói: a ULA do Laboratório 2, o banco de registradores e a RAM do Laboratório 3 e a CPU completa do Laboratório 4 se reduzem todos, no fim, a composições das portas montadas aqui.

## Documentation Links

- [Nand2Tetris: Build a Modern Computer from First Principles](https://www.coursera.org/learn/build-a-computer): o curso real no qual este laboratório e todo o seu arco de construção da CPU se baseiam, começando exatamente por esta progressão do NAND às portas.
- [MIT 6.004: Combinational Logic Unit](https://ocw.mit.edu/courses/6-004-computation-structures-spring-2017/pages/c4/): um segundo curso real e independente que cobre os mesmos fundamentos de lógica combinacional que este laboratório implementa.
