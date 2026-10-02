---
version: 1.0
updatedAt: 2026-09-12
title: "Laboratório: Registradores e RAM a Partir de Flip-Flops"
summary: "Só a lógica combinacional não tem memória, e é por isso que este laboratório implementa um flip-flop D como a primitiva sequencial básica, o compõe num registrador de vários bits com sinal de habilitação de carga e depois compõe um arranjo desses registradores, endereçados por um decodificador construído com as próprias portas do Laboratório 1, numa RAM pequena e funcional, correspondendo aos projetos de De Flip-Flops a um Banco de Registradores e de Organização da RAM e Decodificação de Endereços com código real e executável, em vez de um diagrama de circuito."
---
## Objetivos de Aprendizagem

- Implementar um flip-flop D como uma primitiva de memória de um bit com clock, e explicar por que a lógica combinacional sozinha, construída com as portas do Laboratório 1, não consegue lembrar nada entre ciclos de clock por conta própria.
- Compor flip-flops num registrador de vários bits com um sinal de habilitação de carga que controla se uma borda de clock de fato atualiza o valor guardado.
- Compor um arranjo endereçável de registradores, controlado por um decodificador construído com as portas do Laboratório 1, numa RAM pequena e funcional.
- Verificar que um registrador só se atualiza com um sinal de habilitação de carga, e que a RAM isola corretamente as escritas na palavra endereçada, sem perturbar nenhuma outra palavra.

## Contexto e Motivação

Toda porta construída no Laboratório 1, e toda ULA construída no Laboratório 2, é combinacional: sua saída depende só das entradas atuais, sem memória nenhuma do que veio antes. **De Flip-Flops a um Banco de Registradores** e **Organização da RAM e Decodificação de Endereços** já fizeram o argumento teórico sobre o que fecha essa lacuna: uma primitiva de armazenamento com clock, o flip-flop, que guarda um valor entre ciclos de clock até ser mandada mudar de propósito. Este laboratório constrói essa primitiva e a compõe, primeiro num registrador, depois numa RAM, completando a penúltima peça de que a CPU completa do Laboratório 4 precisa.

## Teoria Central

Nada sobre *por que* a lógica combinacional não consegue lembrar estado, ou *por que* uma borda de clock é o momento certo para permitir uma atualização, é rederivado aqui; esse argumento pertence a `from-flip-flops-to-a-register-file`. Este laboratório implementa o projeto já trabalhado lá: um flip-flop modelado como um pequeno objeto que carrega estado explícito entre chamadas (deliberadamente diferente de toda porta dos Laboratórios 1 e 2, que eram funções puras e sem estado), e um decodificador, construído com portas combinacionais comuns, que seleciona exatamente um registrador entre muitos pelo endereço.

## Exemplos Resolvidos

### Especificação da API

```text
class DFlipFlop:
    def tick(self, data_in: bool, load: bool) -> bool
        # Numa borda de clock simulada: se load for True, guarda data_in e o
        # devolve; se load for False, mantém o valor guardado ANTERIOR e
        # devolve esse no lugar.

class Register(width: int):
    def tick(self, data_in: list[bool], load: bool) -> list[bool]

class RAM(address_bits: int, word_width: int):
    def read(self, address: list[bool]) -> list[bool]
    def tick(self, address: list[bool], data_in: list[bool], write: bool) -> None
```

### Passo 1: o flip-flop D, a única primitiva genuinamente com estado deste arco

```python
class DFlipFlop:
    def __init__(self):
        self._stored = False  # ISTO é a memória; nenhuma porta dos Laboratórios 1-2
                                # tinha qualquer equivalente disso

    def tick(self, data_in: bool, load: bool) -> bool:
        if load:
            self._stored = data_in
        # senão: _stored fica exatamente como estava; é isso que
        # "lembrar entre ciclos" de fato significa em código
        return self._stored
```

### Passo 2: um registrador, N flip-flops batendo juntos

```python
class Register:
    def __init__(self, width: int):
        self._bits = [DFlipFlop() for _ in range(width)]

    def tick(self, data_in: list[bool], load: bool) -> list[bool]:
        return [ff.tick(bit, load) for ff, bit in zip(self._bits, data_in)]
```

### Passo 3: um decodificador construído com as próprias portas do Laboratório 1

```python
def decoder(address: list[bool]) -> list[bool]:
    # Devolve uma lista one-hot: exatamente um True no índice que corresponde
    # ao valor binário de `address`, e todo o resto False; construído
    # inteiramente com AND/NOT, as próprias portas do Laboratório 1, sem nada novo.
    n = len(address)
    outputs = []
    for i in range(2 ** n):
        target_bits = to_bits(i, width=n)
        match = True
        for a_bit, t_bit in zip(address, target_bits):
            match = AND(match, a_bit if t_bit else NOT(a_bit))
        outputs.append(match)
    return outputs
```

### Passo 4: RAM: registradores controlados pelo decodificador

```python
class RAM:
    def __init__(self, address_bits: int, word_width: int):
        self._registers = [Register(word_width) for _ in range(2 ** address_bits)]

    def read(self, address: list[bool]) -> list[bool]:
        select = decoder(address)
        idx = select.index(True)
        return self._registers[idx].tick([False] * len(self._registers[0]._bits), load=False)
        # bater com load=False é uma LEITURA: devolve o valor atual sem
        # mudá-lo, reaproveitando o tick() em vez de um caminho de leitura
        # separado

    def tick(self, address: list[bool], data_in: list[bool], write: bool) -> None:
        select = decoder(address)
        for reg, is_selected in zip(self._registers, select):
            reg.tick(data_in, load=AND(write, is_selected))
            # todo registrador NÃO selecionado ainda bate, mas com load=False,
            # então mantém seu valor antigo; é isso que isola a escrita
            # em exatamente uma palavra endereçada
```

## Equívocos Comuns e Armadilhas

- **"Um registrador pode ser modelado do mesmo jeito que uma porta, como função pura das suas entradas atuais."** A saída de uma porta depende só das entradas atuais; a saída de um registrador num dado ciclo depende do seu valor *guardado*, que depende de todo o seu histórico de cargas anteriores, e é exatamente por isso que o `DFlipFlop` precisa de estado interno real (`self._stored`), algo que nenhuma porta dos Laboratórios 1 e 2 tinha de propósito.
- **"Escrever na RAM significa chamar `load=True` só no registrador endereçado e deixar os outros intocados."** O `tick` do Passo 4 chama todo registrador em toda escrita, mas com o `load` calculado por registrador como `write AND is_selected`; um registrador não selecionado ainda roda seu próprio `tick`, só que com `load=False`, e é isso que deixa corretamente seu valor inalterado, em vez de deixá-lo num estado indefinido e sem clock.
- **"Ler da RAM deveria ser uma operação separada, sem clock, distinta da escrita."** Modelar uma leitura como uma chamada de `tick` com `load=False`, como o Passo 4 faz, mantém a mesma disciplina de primitiva com clock consistente no componente inteiro; tratar leitura e escrita como mecanismos fundamentalmente diferentes tende a introduzir exatamente o tipo de bug assimétrico que um projeto guiado por decodificador quer evitar.

## Resumo

Este laboratório implementa a única primitiva genuinamente com estado da qual todo este arco de construção da CPU depende (o flip-flop D, que guarda um valor entre ciclos de clock simulados até que um sinal de carga permita que ele mude), depois compõe flip-flops num registrador e, por meio de um decodificador construído inteiramente com as próprias portas combinacionais do Laboratório 1, compõe registradores numa RAM endereçável. Isolar corretamente uma escrita em exatamente a palavra endereçada, batendo todo registrador em todo ciclo, mas calculando o próprio sinal `load` de cada um a partir da saída one-hot do decodificador, é o projeto específico que os testes deste laboratório verificam, correspondendo ao relato de `from-flip-flops-to-a-register-file` e `ram-organization-and-address-decoding` sobre como a lógica sequencial e a combinacional se combinam.

## Documentation Links

- [Nand2Tetris: Build a Modern Computer from First Principles](https://www.coursera.org/learn/build-a-computer): o curso real no qual se baseia a progressão de flip-flop a registrador e a RAM deste laboratório.
- [MIT 6.004: Combinational Logic Unit](https://ocw.mit.edu/courses/6-004-computation-structures-spring-2017/pages/c4/): um segundo curso real e independente que cobre a lógica de decodificador e de seleção por endereço implementada aqui.
