---
version: 1.0
updatedAt: 2026-09-12
title: "Laboratório: o Bomb Lab, Engenharia Reversa de x86-64"
summary: "Este laboratório deixa para trás a CPU de brinquedo, personalizada, desta disciplina e passa para código de máquina x86-64 real e compilado: o próprio Bomb Lab da CMU, um binário Linux que lê uma string da entrada padrão e \"explode\" se ela não corresponder a um valor esperado escondido, ao longo de seis fases cada vez mais difíceis, desarmado inteiramente por meio de desmontagem (objdump), de um depurador (gdb) e das habilidades de leitura de registradores e códigos de condição já vistas na teoria em Registradores e Movimentação de Dados x86-64 e Códigos de Condição e Desvios Condicionais, sem acesso ao código-fonte em momento nenhum."
---
## Objetivos de Aprendizagem

- Desmontar um binário x86-64 compilado com `objdump` e ler suas instruções sem acesso ao código-fonte C original.
- Usar o `gdb` para colocar breakpoints, avançar passo a passo por um binário em execução e inspecionar o estado de registradores e de memória em cada fase de uma tarefa real de engenharia reversa.
- Reconhecer padrões compilados comuns (um laço, uma comparação de strings, um switch) diretamente no x86-64 desmontado, e não só no C em nível de código-fonte.
- Recuperar uma string de entrada correta para cada fase do Bomb Lab da CMU puramente a partir do seu comportamento compilado, sem jamais ver seu código-fonte.

## Contexto e Motivação

**Registradores e Movimentação de Dados x86-64** e **Códigos de Condição e Desvios Condicionais** já cobriram, na teoria, quais registradores guardam valores, o que uma instrução como `cmp` ou `je` de fato faz, e como um compilador traduz um `if` de alto nível em saltos condicionais. Este laboratório é onde essas peças, entendidas individualmente, precisam ser lidas juntas, sob pressão real, contra um binário compilado real sem nenhum código-fonte disponível: o próprio Bomb Lab da CMU, um exercício genuinamente conhecido e usado há décadas exatamente nessa habilidade.

## Teoria Central

Nada sobre *por que* os códigos de condição ou os saltos condicionais funcionam é rederivado aqui; os dois já existem em `condition-codes-and-conditional-branches`. Este laboratório é a disciplina de ler x86-64 compilado, produzido por um compilador real fazendo suas próprias escolhas de tradução reais, às vezes surpreendentes, e não instruções acompanhadas à mão, escritas para ilustrar um conceito de forma limpa.

## Exemplos Resolvidos

### A tarefa, exatamente como a CMU a especifica

Uma "bomba binária" é um executável Linux formado por seis fases. Cada fase lê uma linha da entrada padrão; se a linha corresponder a uma string esperada escondida, a fase é "desarmada" e o programa continua para a próxima; caso contrário, a bomba "explode", imprimindo `BOOM!!!` e terminando. As seis fases aumentam em dificuldade: fases posteriores normalmente envolvem laços, arrays ou estruturas recursivas que as anteriores não têm.

### Passo 1: desmontando o binário que contém a fase 1

```text
$ objdump -d bomb | grep -A 20 '<phase_1>:'

0000000000401234 <phase_1>:
  401234:  48 83 ec 08          sub    $0x8,%rsp
  401238:  be 00 24 40 00       mov    $0x402400,%esi
  40123d:  e8 c2 04 00 00       call   401704 <strings_not_equal>
  401242:  85 c0                test   %eax,%eax
  401244:  74 05                je     40124b <phase_1+0x17>
  401246:  e8 e9 05 00 00       call   401834 <explode_bomb>
  40124b:  48 83 c4 08          add    $0x8,%rsp
  40124f:  c3                   ret
```

Lendo isto diretamente, sem nenhum código-fonte: `%esi` é carregado com o endereço `0x402400` (uma constante de string), `strings_not_equal` é chamado comparando essa string com a entrada da própria fase, e `test %eax, %eax` seguido de `je` (salta se igual, ou seja, se o resultado da comparação foi zero) desvia por cima da chamada a `explode_bomb`. A string esperada não é calculada; ela é simplesmente lida diretamente da seção de dados do binário no endereço `0x402400`.

### Passo 2: encontrando a constante de string com o gdb

```text
$ gdb bomb
(gdb) break phase_1
(gdb) run
(gdb) x/s 0x402400
0x402400:  "Border relations with Canada have never been better."
```

`x/s` (examinar como string) lê os bytes reais naquele endereço como uma string terminada em nulo, exatamente o valor que a desmontagem de `phase_1` mostrou sendo comparado. Digitar essa string exata como entrada do programa desarma a fase 1.

### Passo 3: uma fase mais difícil envolvendo um laço, lida de forma estrutural

```text
  401260:  b8 00 00 00 00       mov    $0x0,%eax        # eax = 0 (acumulador)
  401265:  <corpo do laço calculando algo em %eax, usando %ecx como contador>
  401270:  83 c1 01             add    $0x1,%ecx         # contador += 1
  401273:  83 f9 06             cmp    $0x6,%ecx          # contador == 6 ?
  401276:  75 ed                jne    401265             # repete enquanto contador != 6

```

Esse padrão, `add $0x1, reg` seguido de `cmp` contra um limite fixo e um salto condicional de volta para o início do laço, é exatamente como um compilador traduz um `for (i = 0; i < 6; i++)` comum em x86-64; reconhecer essa forma diretamente na desmontagem, sem um laço em nível de código-fonte para consultar, é a habilidade específica que esta fase, e fases posteriores com mais estrutura aninhada, foi feita para exercitar.

### Passo 4: usando o gdb para checar uma hipótese diretamente, em vez de adivinhar às cegas

```text
(gdb) break phase_3
(gdb) run
[entrada de uma string chutada]
(gdb) print $eax
$1 = 0
(gdb) print/x $rsp
$2 = 0x7fffffffe310
```

Imprimir valores de registradores e de memória num breakpoint transforma uma hipótese sobre o que uma fase espera, formada lendo a desmontagem, num fato diretamente conferível, em vez de chutar repetidamente strings de entrada inteiras e rodar o programa todo de novo desde o começo.

## Equívocos Comuns e Armadilhas

- **"Sem o código-fonte, não há forma confiável de saber o que uma função compilada de fato faz."** A premissa inteira deste laboratório, e as próprias décadas de uso dele pela CMU, é o contrário: as instruções x86-64 correspondem a padrões reconhecíveis e recorrentes (comparação de strings, estrutura de laço, desvio condicional) a partir dos quais um leitor cuidadoso consegue reconstruir a lógica diretamente, que é exatamente a habilidade para a qual `x86-64-registers-and-data-movement` e `condition-codes-and-conditional-branches` existem para construir.
- **"Simplesmente rodar o binário repetidamente com entradas chutadas diferentes é uma estratégia viável."** Para uma fase com qualquer lógica real além de uma única comparação de strings, o espaço de entradas é grande demais para adivinhar às cegas; a abordagem de desmontar primeiro dos Passos 1 a 3, lendo o que a fase de fato confere antes de tentar uma entrada, é o que torna cada fase tratável num tempo razoável.
- **"O gdb só é útil para encontrar bugs em código que você mesmo escreveu."** O Passo 4 o usa com um propósito genuinamente diferente, checar uma hipótese sobre o comportamento do código já compilado de outra pessoa num ponto específico, que é precisamente o caso de uso de engenharia reversa em torno do qual este laboratório é construído: distinto da depuração comum, mas usando exatamente a mesma ferramenta.

## Resumo

Este laboratório aplica o conteúdo teórico de `x86-64-registers-and-data-movement` e `condition-codes-and-conditional-branches` ao próprio Bomb Lab real e amplamente usado da CMU: desmontar um binário compilado sem nenhum código-fonte disponível, ler padrões compilados reconhecíveis (comparações de strings, laços, desvios condicionais) diretamente no x86-64 e usar o gdb não para encontrar um bug no próprio código, mas para checar uma hipótese sobre a lógica já compilada de outra pessoa. Desarmar com sucesso as seis fases significa recuperar as strings de entrada escondidas exatas puramente a partir do comportamento compilado do próprio binário: o retorno concreto e prático da teoria de registradores e códigos de condição que os conceitos pré-requisitos deste laboratório já cobrem.

## Documentation Links

- [CS:APP: Lab Assignments (Bomb Lab)](https://csapp.cs.cmu.edu/3e/labs.html): o próprio Bomb Lab oficial da CMU ao qual este exercício corresponde exatamente, incluindo toda a sua documentação para instrutores e estudantes.
- [Stanford CS107: Guide to x86-64](https://web.stanford.edu/class/cs107/guide/x86-64.html): uma referência real e amplamente usada para ler desmontagem de x86-64, cobrindo as convenções de registradores e de padrões de instrução das quais este laboratório depende.
