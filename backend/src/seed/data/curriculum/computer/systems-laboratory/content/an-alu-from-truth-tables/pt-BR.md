---
version: 1.0
updatedAt: 2026-09-12
title: "Laboratório: uma ULA a Partir de Tabelas Verdade"
summary: "Este laboratório compõe o conjunto de portas do Laboratório 1 numa ULA funcional que corresponde ao projeto já trabalhado na teoria em Projetando uma Unidade Lógica e Aritmética: um somador ripple-carry construído com somadores completos feitos com as próprias portas AND/XOR do Laboratório 1, um multiplexador de seleção de operação escolhendo entre soma, subtração, AND e OR, e flags de zero e de overflow calculadas diretamente a partir dos bits de saída do próprio somador, e não como um acréscimo pregado separadamente."
---
## Objetivos de Aprendizagem

- Implementar um somador completo de 1 bit com o conjunto de portas do Laboratório 1 e, depois, encadeá-lo num somador ripple-carry de N bits.
- Implementar um multiplexador de seleção de operação que direciona a saída da ULA entre soma, subtração (por complemento de dois), AND e OR, comandado por um código de controle.
- Implementar flags de zero e de overflow calculadas diretamente a partir dos bits de saída e de carry do próprio somador.
- Verificar a ULA pronta contra uma tabela de resultados esperados calculados à mão, cobrindo valores comuns, zero e um caso de overflow escolhido de propósito.

## Contexto e Motivação

**Projetando uma Unidade Lógica e Aritmética** e **Seleção de Operação da ULA e Flags** já trabalharam, no papel, do que uma ULA precisa: um núcleo somador reaproveitado tanto para soma quanto para subtração, uma forma de selecionar qual resultado de operação de fato chega à saída, e flags que resumem propriedades desse resultado sobre as quais uma instrução posterior pode desviar. Este laboratório constrói esse projeto de verdade, com o próprio conjunto de portas do Laboratório 1, e sua saída pronta vira o núcleo aritmético do Laboratório 4 quando a CPU completa for montada.

## Teoria Central

Nada sobre *por que* a subtração reaproveita o somador (pela negação em complemento de dois) ou *por que* um somador ripple-carry é construído com somadores completos encadeados é rederivado aqui; os dois argumentos já existem em `designing-an-arithmetic-logic-unit`. Este laboratório é a disciplina de implementar esse projeto e testá-lo contra entradas reais e concretas, e não de rederivá-lo.

## Exemplos Resolvidos

### Especificação da API

```text
ALU(a: list[bool], b: list[bool], op: str) -> (result: list[bool], zero: bool, overflow: bool)
  # a, b: operandos de N bits em complemento de dois, LSB primeiro
  # op: um entre "ADD", "SUB", "AND", "OR"
```

### Passo 1: um somador completo de 1 bit e, depois, um somador de N bits encadeado

```python
def full_adder(a: bool, b: bool, carry_in: bool) -> tuple[bool, bool]:
    sum_bit = XOR(XOR(a, b), carry_in)
    carry_out = OR(AND(a, b), AND(carry_in, XOR(a, b)))
    return sum_bit, carry_out

def ripple_carry_adder(a: list[bool], b: list[bool], carry_in: bool) -> tuple[list[bool], bool]:
    result = []
    carry = carry_in
    for bit_a, bit_b in zip(a, b):  # LSB primeiro: bate com a ordem do hardware real
        s, carry = full_adder(bit_a, bit_b, carry)
        result.append(s)
    return result, carry  # o carry final serve também de sinal de overflow, veja o Passo 3
```

### Passo 2: subtração, reaproveitando o MESMO somador por complemento de dois

```python
def twos_complement_negate(bits: list[bool]) -> list[bool]:
    inverted = [NOT(b) for b in bits]
    incremented, _ = ripple_carry_adder(inverted, [True] + [False] * (len(bits) - 1), False)
    return incremented

def alu_add_or_sub(a: list[bool], b: list[bool], subtract: bool) -> tuple[list[bool], bool]:
    operand_b = twos_complement_negate(b) if subtract else b
    return ripple_carry_adder(a, operand_b, subtract)  # subtract=True também
                                                          # inicia carry_in=1,
                                                          # completando a-b = a+(-b)+...
                                                          # conforme o projeto
                                                          # de designing-an-
                                                          # arithmetic-logic-unit
```

Não existe circuito subtrator separado em lugar nenhum deste laboratório; toda subtração é literalmente uma soma com um operando negado, rodada exatamente pelo mesmo `ripple_carry_adder` do Passo 1, que é o ponto inteiro que o próprio projeto de Projetando uma Unidade Lógica e Aritmética faz: um somador, reaproveitado, e não dois circuitos separados.

### Passo 3: seleção de operação e flags

```python
def ALU(a: list[bool], b: list[bool], op: str):
    add_result, carry_out = alu_add_or_sub(a, b, subtract=(op == "SUB"))
    and_result = [AND(x, y) for x, y in zip(a, b)]
    or_result = [OR(x, y) for x, y in zip(a, b)]

    result = {
        "ADD": add_result, "SUB": add_result,
        "AND": and_result, "OR": or_result,
    }[op]

    zero = not any(result)  # verdadeiro se e somente se todo bit de saída for 0
    sign_a, sign_b, sign_r = a[-1], b[-1], result[-1]  # MSB = bit de sinal
    overflow = (op in ("ADD", "SUB")) and AND(XOR(sign_a, sign_r), NOT(XOR(sign_a, sign_b) if op == "ADD" else XOR(sign_a, sign_b)))
    return result, zero, overflow
```

### Passo 4: verificação contra casos calculados à mão

```python
def test_alu_add_basic():
    a = to_bits(5, width=8)   # 5  = 00000101
    b = to_bits(3, width=8)   # 3  = 00000011
    result, zero, overflow = ALU(a, b, "ADD")
    assert from_bits(result) == 8 and not zero and not overflow

def test_alu_zero_flag():
    a = to_bits(5, width=8)
    b = to_bits(5, width=8)
    result, zero, overflow = ALU(a, b, "SUB")  # 5 - 5 = 0
    assert from_bits(result) == 0 and zero

def test_alu_signed_overflow():
    a = to_bits(127, width=8)   # maior valor positivo com sinal em 8 bits
    b = to_bits(1, width=8)
    result, zero, overflow = ALU(a, b, "ADD")  # 127 + 1 dá overflow para negativo
    assert overflow, "somar 1 ao maior valor positivo com sinal precisa dar overflow"
```

## Equívocos Comuns e Armadilhas

- **"A subtração precisa de um circuito próprio e dedicado, parecido com um somador."** O ponto inteiro do projeto de `designing-an-arithmetic-logic-unit` é que não precisa: negar um operando por complemento de dois e reaproveitar exatamente o mesmo somador, como o Passo 2 faz, é o que impede que o custo de hardware da ULA dobre por causa de uma segunda operação aritmética.
- **"A flag de zero é um pedaço separado de estado que a ULA precisa acompanhar entre operações."** Ela é uma função pura e sem estado só do resultado atual (todo bit vale 0), calculada do mesmo jeito, seja qual for a operação que produziu esse resultado; nenhuma memória de operações anteriores é necessária nem usada.
- **"Overflow só significa que o resultado não cabe no número de bits disponíveis."** Na aritmética com sinal em complemento de dois especificamente, o overflow é uma condição mais estreita e precisa (o sinal do resultado é inconsistente com o que os sinais dos operandos deveriam ter produzido), exatamente o que o cálculo de overflow do Passo 3 confere; um carry saindo do bit mais significativo, sozinho, é uma noção diferente, válida só sem sinal, que este projeto corretamente não confunde com ela.

## Resumo

Este laboratório implementa a ULA que `designing-an-arithmetic-logic-unit` e `alu-operation-selection-and-flags` projetaram no papel: um somador completo encadeado num somador ripple-carry de N bits, a subtração implementada reaproveitando esse mesmo somador com um operando negado em complemento de dois, em vez de um segundo circuito, e flags de zero e de overflow calculadas de forma direta e sem estado a partir do resultado atual. Testar contra casos calculados à mão (uma soma comum, uma subtração que cai exatamente em zero e um caso de overflow com sinal escolhido de propósito) verifica a implementação contra aritmética real e conferível, em vez de confiar que a composição de portas está correta por construção.

## Documentation Links

- [Nand2Tetris: Build a Modern Computer from First Principles](https://www.coursera.org/learn/build-a-computer): o curso real no qual se baseiam o projeto de ULA deste laboratório e sua metodologia de construir a partir de portas.
- [Harris & Harris: Digital Design and Computer Architecture, RISC-V Edition](https://shop.elsevier.com/books/digital-design-and-computer-architecture-risc-v-edition/harris/978-0-12-820064-3): o livro-texto que é fonte do projeto de ULA baseado em somador e do cálculo da flag de overflow que este laboratório implementa.
