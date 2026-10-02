---
version: 1.0
updatedAt: 2026-09-12
title: "Laboratório: Montando uma CPU Monociclo Completa, de Verdade"
summary: "Cada laboratório anterior deste arco construiu um componente; este laboratório liga a ULA do Laboratório 2, o banco de registradores e a RAM do Laboratório 3 e uma unidade de controle que decodifica a própria ISA no estilo RISC-V deste currículo numa única CPU completa que de fato busca, decodifica e executa uma sequência real de instruções, conforme o próprio projeto de Montando uma CPU Monociclo Completa e o projeto da CPU Beta do MIT 6.004, verificada não por inspeção, mas carregando um pequeno programa montado à mão na RAM construída e confirmando que o banco de registradores termina no estado esperado depois da execução."
---
## Objetivos de Aprendizagem

- Ligar a ULA do Laboratório 2, o banco de registradores e a RAM do Laboratório 3 e uma nova unidade de controle numa única CPU monociclo completa.
- Implementar o ciclo de busca, decodificação e execução como uma função rodada repetidamente: ler uma instrução da RAM no contador de programa, decodificar seus campos, executá-la pela ULA e pelo banco de registradores e avançar o contador de programa.
- Implementar a decodificação de um pequeno subconjunto da própria ISA no estilo RISC-V deste currículo, suficiente para rodar um programa real, ainda que pequeno.
- Verificar a CPU pronta carregando uma sequência de instruções montada à mão na RAM e confirmando que o banco de registradores termina exatamente no estado esperado depois da execução.

## Contexto e Motivação

**Montando uma CPU Monociclo Completa** e **O Ciclo de Busca, Decodificação e Execução** já expuseram, no papel, exatamente como um datapath, uma ULA, um banco de registradores e uma unidade de controle se combinam num processador funcional. Este laboratório é onde todo laboratório anterior deste arco (as portas do Laboratório 1, a ULA do Laboratório 2, o banco de registradores e a RAM do Laboratório 3) é ligado nessa máquina completa, conforme o próprio projeto Building the Beta do MIT 6.004 e o próprio capítulo de CPU do Nand2Tetris, e seu teste real não é inspecionar a fiação, mas carregar um programa e vê-lo de fato rodar.

## Teoria Central

Nada sobre *por que* um projeto monociclo executa uma instrução completa por ciclo de clock, ou *por que* o trabalho da unidade de controle é traduzir o opcode de uma instrução nos sinais de controle específicos de que todo outro componente precisa, é rederivado aqui; os dois argumentos já existem em `assembling-a-complete-single-cycle-cpu` e `the-control-unit`. Este laboratório é a disciplina de implementar esse projeto contra um pequeno subconjunto concreto de instruções e rodá-lo.

## Exemplos Resolvidos

### Especificação da API

```text
Subconjunto de instruções implementado (uma pequena fatia da própria ISA no
estilo RISC-V do currículo, de a-simple-risc-v-style-isa):
  ADD  rd, rs1, rs2   # rd = rs1 + rs2
  SUB  rd, rs1, rs2   # rd = rs1 - rs2
  ADDI rd, rs1, imm   # rd = rs1 + imm
  LW   rd, offset(rs1)  # rd = RAM[rs1 + offset]
  SW   rs2, offset(rs1) # RAM[rs1 + offset] = rs2
  BEQ  rs1, rs2, offset # se rs1 == rs2: PC += offset, senão PC += 4
```

### Passo 1: a unidade de controle, traduzindo um opcode em sinais de controle

```python
def control_unit(opcode: int) -> dict:
    # Cada entrada diz exatamente o que todo outro componente precisa fazer
    # para esta instrução; ISSO é o que "controle" significa de forma concreta.
    return {
        OP_ADD:  {"alu_op": "ADD", "reg_write": True,  "mem_write": False, "branch": False},
        OP_SUB:  {"alu_op": "SUB", "reg_write": True,  "mem_write": False, "branch": False},
        OP_ADDI: {"alu_op": "ADD", "reg_write": True,  "mem_write": False, "branch": False},
        OP_LW:   {"alu_op": "ADD", "reg_write": True,  "mem_write": False, "branch": False, "mem_to_reg": True},
        OP_SW:   {"alu_op": "ADD", "reg_write": False, "mem_write": True,  "branch": False},
        OP_BEQ:  {"alu_op": "SUB", "reg_write": False, "mem_write": False, "branch": True},
    }[opcode]
```

### Passo 2: um ciclo de busca, decodificação e execução, exatamente como a teoria o descreve

```python
def step(cpu: CPU) -> None:
    # BUSCA: lê a instrução para a qual o contador de programa aponta no momento
    instruction = cpu.ram.read(cpu.pc)
    opcode, rd, rs1, rs2, imm = decode_fields(instruction)  # DECODIFICAÇÃO

    ctrl = control_unit(opcode)

    # EXECUÇÃO: a ULA roda seja qual for o tipo de instrução; é exatamente a
    # propriedade que define o próprio projeto monociclo: toda instrução flui
    # pelo MESMO datapath, só que com sinais de controle diferentes conduzindo-a
    operand_b = imm if opcode in (OP_ADDI, OP_LW, OP_SW) else cpu.regfile.read(rs2)
    alu_result, zero, _ = ALU(cpu.regfile.read(rs1), operand_b, ctrl["alu_op"])

    if ctrl["mem_write"]:
        cpu.ram.tick(alu_result, cpu.regfile.read(rs2), write=True)
    if ctrl["reg_write"]:
        write_value = cpu.ram.read(alu_result) if ctrl.get("mem_to_reg") else alu_result
        cpu.regfile.tick(rd, write_value, load=True)

    # avança o contador de programa: desvia se a unidade de controle mandar
    # E a própria flag zero da ULA confirmar que a condição do desvio valeu
    if ctrl["branch"] and zero:
        cpu.pc += imm
    else:
        cpu.pc += 4
```

### Passo 3: um programa montado à mão, carregado e rodado

```python
program = [
    encode(OP_ADDI, rd=1, rs1=0, imm=5),   # r1 = r0 + 5  (r0 é fixo em 0)
    encode(OP_ADDI, rd=2, rs1=0, imm=3),   # r2 = r0 + 3
    encode(OP_ADD,  rd=3, rs1=1, rs2=2),   # r3 = r1 + r2  ->  espera-se r3 = 8
]

def test_add_program_end_to_end():
    cpu = CPU()
    cpu.ram.load(address=0, words=program)
    for _ in range(len(program)):
        step(cpu)
    assert cpu.regfile.read(3) == 8, "r3 deve guardar 5 + 3 = 8 depois de rodar o programa"
```

Esse é o critério real de correção do laboratório: não confirmar por inspeção que cada fio está ligado, mas carregar um programa que nenhum componente deste arco viu antes e confirmar que o banco de registradores (o mesmo construído no Laboratório 3) termina exatamente no estado que um humano acompanhando o programa à mão preveria.

## Equívocos Comuns e Armadilhas

- **"Instruções diferentes deveriam ter cada uma seu próprio caminho de execução separado pela CPU."** O ponto inteiro do projeto monociclo, feito em `assembling-a-complete-single-cycle-cpu`, é o contrário: toda instrução flui pelo MESMO datapath (a mesma chamada à ULA, as mesmas portas do banco de registradores), e são os sinais da unidade de controle, e não um caminho de código diferente, que determinam o que de fato acontece; a função `step` do Passo 2 tem exatamente um caminho de execução para todo opcode.
- **"O desvio deveria atualizar o contador de programa diretamente a partir da unidade de controle."** A unidade de controle só decide se uma instrução *pode* desviar (`ctrl["branch"]`); se ela de fato desvia depende da própria flag zero da ULA do Laboratório 2, calculada subtraindo literalmente os dois valores de registrador comparados, exatamente o acoplamento entre controle e datapath que `the-fetch-decode-execute-cycle` descreve.
- **"Testar instruções individuais isoladamente basta; um programa de várias instruções deveria funcionar automaticamente se cada uma funcionar."** O teste do Passo 3 roda especificamente uma pequena sequência em que uma instrução posterior (`ADD r3, r1, r2`) depende de valores escritos por duas anteriores; um bug em como o contador de programa avança, ou em como um valor de registrador escrito fica de fato visível para a próxima instrução, só aparece quando as instruções rodam em sequência, e não em testes isolados de uma única instrução.

## Resumo

Este laboratório liga todo laboratório anterior deste arco (as portas do Laboratório 1 por meio da ULA do Laboratório 2, o banco de registradores e a RAM do Laboratório 3) numa única CPU monociclo completa, com uma unidade de controle que traduz o opcode de cada instrução nos sinais específicos que conduzem um único datapath compartilhado, correspondendo exatamente ao próprio projeto de `assembling-a-complete-single-cycle-cpu` e `the-fetch-decode-execute-cycle`, incluindo o acoplamento entre o sinal de desvio da unidade de controle e a própria flag zero da ULA. O teste real do laboratório não é inspecionar a fiação, mas carregar um pequeno programa de várias instruções montado à mão e confirmar que o banco de registradores termina exatamente no estado que um humano acompanhando o programa à mão preveria.

## Documentation Links

- [MIT 6.004: Building the Beta](https://computationstructures.org/lectures/beta/beta.html): o projeto real no qual se baseiam a CPU completa e ligada deste laboratório e seu laço de busca, decodificação e execução.
- [Nand2Tetris: Build a Modern Computer from First Principles](https://www.coursera.org/learn/build-a-computer): um segundo curso real e independente que cobre a mesma montagem de CPU completa que este laboratório implementa.
