---
version: 1.0
updatedAt: 2026-09-12
title: "Laboratório: um Montador para a Sua Própria ISA"
summary: "Este laboratório fecha o arco de construção da CPU escrevendo a ferramenta que torna a CPU do Laboratório 4 de fato utilizável: um montador de duas passagens que primeiro resolve cada rótulo num endereço (uma tabela de símbolos construída numa primeira passagem pelo código-fonte) e depois traduz cada instrução com mnemônico no padrão de bits exato que a unidade de controle do Laboratório 4 decodifica, conforme o próprio relato do processo em Tradução de Assembly para Código de Máquina, com a saída do montador pronto carregada diretamente de volta na RAM do Laboratório 4 como o teste real de correção de ponta a ponta deste laboratório."
---
## Objetivos de Aprendizagem

- Implementar um montador de duas passagens: uma primeira passagem que constrói uma tabela de símbolos mapeando rótulos em endereços, e uma segunda que traduz cada instrução com mnemônico no padrão de bits exato que a CPU do Laboratório 4 decodifica.
- Explicar por que a resolução de rótulos exige de fato duas passagens, e não uma, usando um desvio para a frente como o caso concreto e motivador.
- Implementar a codificação do mesmo pequeno subconjunto de instruções que a unidade de controle do Laboratório 4 entende, correspondendo exatamente ao seu leiaute de campos.
- Verificar a correção de ponta a ponta: montar um programa-fonte, carregar a própria saída do montador diretamente na CPU do Laboratório 4 e confirmar que ele roda corretamente, sem nenhuma codificação à mão em lugar nenhum do pipeline.

## Contexto e Motivação

O programa de teste do Laboratório 4 foi montado à mão, com o padrão de bits exato de cada instrução calculado por um humano antes de chegar à CPU. Este laboratório fecha essa lacuna, e fecha todo o arco de construção da CPU desta disciplina, escrevendo a ferramenta que torna a CPU do Laboratório 4 de fato utilizável sem um humano fazendo essa tradução à mão: um montador real, conforme o próprio relato do processo em **Tradução de Assembly para Código de Máquina**.

## Teoria Central

Nada sobre *por que* a tradução de assembly para código de máquina é fundamentalmente um problema de substituição (mnemônicos por opcodes, nomes de registradores por números de registradores, rótulos por endereços) é rederivado aqui; esse argumento pertence a `assembly-to-machine-code-translation`. Este laboratório o implementa e, especificamente, implementa a única parte que uma abordagem ingênua de passagem única não consegue tratar corretamente: uma instrução de desvio que referencia um rótulo que ainda não foi definido no código-fonte, uma referência à frente.

## Exemplos Resolvidos

### Especificação da API

```text
assemble(source: str) -> list[int]
  # source: texto assembly, uma instrução ou rótulo por linha
  # devolve: uma lista de instruções codificadas de 32 bits, na ordem do programa,
  #          prontas para carregar DIRETAMENTE na RAM da CPU via cpu.ram.load()
```

### Passo 1: por que uma passagem não basta: o problema da referência à frente

```text
      ADDI r1, r0, 0        # endereço 0:  r1 = 0 (contador do laço)
loop: ADDI r1, r1, 1        # endereço 4
      BEQ  r1, r2, done     # endereço 8:  "done" ainda não foi visto no
                              #              texto-fonte a esta altura
      BEQ  r0, r0, loop     # endereço 12
done: ADD  r3, r1, r1       # endereço 16: É AQUI que "done" é definido
```

Traduzir `BEQ r1, r2, done` exige conhecer o endereço de `done`, 16, mas uma única passagem da esquerda para a direita chega a essa linha `BEQ` antes de ter sequer visto o rótulo `done:`. Isso não é um caso extremo: desvios para a frente (pular o corpo de um laço, saltar por cima de uma cláusula else) são extremamente comuns em programas reais, e é exatamente por isso que todo montador real, incluindo o deste laboratório, usa duas passagens.

### Passo 2: primeira passagem: construir a tabela de símbolos, sem codificar nada ainda

```python
def build_symbol_table(lines: list[str]) -> dict[str, int]:
    symbols = {}
    address = 0
    for line in lines:
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if ":" in line:
            label, _, rest = line.partition(":")
            symbols[label.strip()] = address
            line = rest.strip()
            if not line:
                continue  # um rótulo sozinho na linha, sem instrução depois
        address += 4  # toda instrução desta ISA tem exatamente 4 bytes
    return symbols
```

### Passo 3: segunda passagem: codificar, agora com TODO rótulo já resolvido

```python
def assemble(source: str) -> list[int]:
    lines = source.splitlines()
    symbols = build_symbol_table(lines)  # a primeira passagem, completa, antes de a segunda começar

    encoded = []
    address = 0
    for raw_line in lines:
        line = strip_label(raw_line).strip()
        if not line or line.startswith("#"):
            continue
        mnemonic, *operands = tokenize(line)
        if mnemonic == "BEQ":
            rs1, rs2, target_label = operands
            offset = symbols[target_label] - address  # AGORA resolvível,
                                                         # já que a primeira
                                                         # passagem já rodou
            encoded.append(encode(OP_BEQ, rs1=reg(rs1), rs2=reg(rs2), imm=offset))
        else:
            encoded.append(encode_ordinary(mnemonic, operands))
        address += 4
    return encoded
```

### Passo 4: o teste real de correção, de ponta a ponta

```python
def test_assembler_output_runs_correctly_on_lab4_cpu():
    source = """
        ADDI r1, r0, 0
    loop:
        ADDI r1, r1, 1
        ADDI r2, r0, 5
        BEQ  r1, r2, done
        BEQ  r0, r0, loop
    done:
        ADD  r3, r1, r1
    """
    machine_code = assemble(source)  # a própria saída DESTE laboratório

    cpu = CPU()  # a CPU do Laboratório 4, sem nenhuma modificação
    cpu.ram.load(address=0, words=machine_code)
    for _ in range(20):  # passos mais que suficientes para chegar a "done"
        step(cpu)

    assert cpu.regfile.read(3) == 10, "o laço deve contar até 5, e então r3 = 5+5 = 10"
```

Nenhuma instrução codificada à mão aparece em lugar nenhum deste teste; a própria saída do montador, recebendo nada além de texto assembly legível com um rótulo referenciado à frente, é o que a CPU não modificada do Laboratório 4 de fato executa, e essa é a prova real, de ponta a ponta, de que o projeto de duas passagens deste laboratório funciona.

## Equívocos Comuns e Armadilhas

- **"Uma única passagem consegue tratar referências à frente simplesmente pulando-as e voltando depois."** Isso é, na prática, reinventar uma segunda passagem com outro nome; a estrutura limpa e padrão que os Passos 2 e 3 usam (completar a tabela de símbolos inteira antes de codificar uma única instrução) evita a complexidade de contabilidade de acompanhar quais instruções específicas ainda precisam de um remendo posterior.
- **"A codificação deveria poder acontecer ao mesmo tempo que a leitura do código-fonte, para economizar uma passagem pelo arquivo."** Para um programa com qualquer desvio para a frente, isso não é só um trade-off de otimização: produz um montador simplesmente incorreto exatamente nos padrões de laço e de condicional que os programas reais usam o tempo todo, como mostra o exemplo concreto do Passo 1.
- **"Testar o montador significa conferir sua saída codificada byte a byte contra valores esperados."** Essa é uma verificação razoável em nível de unidade, mas o teste de ponta a ponta do Passo 4 (alimentar a CPU não modificada do Laboratório 4 diretamente com a saída do montador e conferir o estado resultante dos registradores) é o que de fato fecha o ciclo para o qual todo este arco vinha construindo: texto-fonte entrando, estado final correto da CPU saindo, sem nenhum passo de tradução manual no meio.

## Resumo

Este laboratório fecha o arco de construção da CPU implementando um montador real de duas passagens: uma primeira passagem que constrói uma tabela de símbolos completa com o endereço de cada rótulo antes de qualquer instrução ser codificada, e uma segunda passagem que traduz cada mnemônico no padrão de bits exato que a CPU do Laboratório 4 decodifica, com os alvos de desvio referenciados à frente (o caso concreto que uma passagem única não consegue tratar corretamente) resolvidos porque a tabela de símbolos já está completa quando a codificação começa. A prova real de correção do laboratório é de ponta a ponta: um texto-fonte assembly contendo um laço com um desvio para a frente, montado pelo próprio código deste laboratório e rodado, sem modificação, na CPU do Laboratório 4, produzindo exatamente o estado final de registradores que um humano acompanhando o programa à mão preveria.

## Documentation Links

- [Nand2Tetris: Build a Modern Computer from First Principles](https://www.coursera.org/learn/build-a-computer): o curso real cujo próprio projeto de montador serve de modelo para o projeto de duas passagens deste laboratório.
- [Harris & Harris: Digital Design and Computer Architecture, RISC-V Edition](https://shop.elsevier.com/books/digital-design-and-computer-architecture-risc-v-edition/harris/978-0-12-820064-3): o livro-texto que é fonte da codificação de instruções que o montador deste laboratório produz, correspondendo à própria lógica de decodificação do Laboratório 4.
