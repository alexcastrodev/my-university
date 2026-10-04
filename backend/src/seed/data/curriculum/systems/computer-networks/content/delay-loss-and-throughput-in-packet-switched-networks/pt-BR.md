---
version: 1.0
updatedAt: 2026-09-06
title: "Atraso, Perda e Vazão em Redes de Comutação de Pacotes"
summary: "Quatro tipos de atraso que um pacote acumula a cada salto (processamento, enfileiramento, transmissão, propagação), além da perda por buffers cheios e da vazão como a taxa real em que os dados se movem, com o produto largura-de-banda-atraso dando os números reais por trás de por que um único enlace lento em qualquer ponto de um caminho pode dominar o desempenho de uma conexão inteira."
---
## Objetivos de Aprendizagem

- Nomear e definir os quatro componentes do atraso nodal: processamento, enfileiramento, transmissão e propagação.
- Computar o atraso de transmissão e o atraso de propagação separadamente para um dado enlace, e explicar por que eles são fáceis de confundir, mas governam quantidades físicas diferentes.
- Definir a intensidade de tráfego e explicar, qualitativamente e com uma fórmula, por que o atraso médio de enfileiramento cresce sem limite à medida que a intensidade de tráfego se aproxima de 1.
- Definir a perda de pacotes como uma consequência da capacidade finita do buffer, e explicar por que ela é uma característica normal e esperada de uma rede de comutação de pacotes, em vez de uma falha rara.
- Distinguir a vazão instantânea da vazão média, e identificar o enlace gargalo ao longo de um caminho como o que determina a vazão de ponta a ponta.

## Contexto e Motivação

O conceito anterior introduziu o atraso de transmissão de armazena-e-encaminha isoladamente, como o tempo para empurrar os bits de um pacote para um único enlace. Esse é apenas um de quatro componentes de atraso distintos que um pacote acumula a cada salto em seu caminho através do núcleo da rede, e de longe o mais importante dos quatro de entender profundamente é o atraso de enfileiramento, porque, ao contrário dos outros três, que são essencialmente fixos dado o tamanho de um pacote e as propriedades físicas de um enlace, o atraso de enfileiramento depende inteiramente de quanto outro tráfego por acaso está competindo pelo mesmo enlace naquele exato momento, e ele pode crescer explosivamente à medida que uma rede se aproxima de sua capacidade.

Este conceito desenvolve o atraso nodal por completo, introduz a intensidade de tráfego como a ferramenta para raciocinar sobre o atraso de enfileiramento quantitativamente, e define a perda de pacotes e a vazão como as outras duas quantidades definidoras de desempenho às quais todo conceito posterior nesta disciplina (a estimativa de timeout do TCP, a resposta do controle de congestionamento à perda, a experiência prática de "a rede está lenta") em última análise remonta.

## Teoria Central

### Os quatro componentes do atraso nodal

A cada nó (roteador ou host) por que um pacote passa, ele experimenta:

1. **Atraso de processamento (`d_proc`)**: o tempo para um roteador examinar o cabeçalho do pacote (para decidir, por exemplo, em qual enlace de saída encaminhá-lo) e realizar quaisquer verificações necessárias. Tipicamente na ordem de microssegundos ou menos em roteadores modernos.
2. **Atraso de enfileiramento (`d_queue`)**: o tempo que o pacote espera em um buffer de saída antes que possa ser transmitido, porque o enlace de saída está atualmente ocupado transmitindo outro pacote. Este é o mais variável dos quatro, e o foco do resto deste conceito.
3. **Atraso de transmissão (`d_trans`)**: `L/R`, o tempo para empurrar todos os `L` bits do pacote para o enlace, à taxa de transmissão `R` do enlace. Já introduzido no conceito anterior.
4. **Atraso de propagação (`d_prop`)**: o tempo para um único bit, uma vez transmitido, viajar fisicamente o comprimento do enlace, a perto da velocidade da luz no meio. Depende apenas do comprimento físico do enlace, nunca do tamanho do pacote ou da taxa de transmissão do enlace.

O atraso nodal total é a soma: `d_nodal = d_proc + d_queue + d_trans + d_prop`.

### Atraso de transmissão vs. atraso de propagação: uma confusão genuinamente comum

O atraso de transmissão depende do tamanho do pacote `L` e da taxa do enlace `R` (pacote maior, ou enlace mais lento, significa atraso de transmissão mais longo); o atraso de propagação depende apenas do comprimento físico do enlace e da velocidade de propagação do sinal naquele meio, ele não depende do tamanho do pacote ou da taxa do enlace de forma alguma. Um pacote muito curto enviado por um enlace muito rápido pode ter atraso de transmissão desprezível enquanto ainda incorre em atraso de propagação substancial se o enlace abranger, digamos, uma rota de fibra transcontinental, e vice-versa: um enlace lento pode ter grande atraso de transmissão para um pacote grande mesmo que seja fisicamente curto. Esses dois atrasos medem fenômenos físicos genuinamente diferentes e não devem ser confundidos, mesmo que ambos sejam, informalmente, "quanto tempo leva para o pacote atravessar este único enlace".

### Atraso de enfileiramento e intensidade de tráfego

O atraso de enfileiramento depende de quantos outros pacotes já estão enfileirados à frente de um dado pacote no buffer de saída de um roteador, o que por sua vez depende de como a taxa de pacotes chegando se compara à taxa em que o enlace pode atendê-los. Defina a intensidade de tráfego como `La/R`, onde `L` é o comprimento médio do pacote, `a` é a taxa média de chegada de pacotes, e `R` é a taxa de transmissão do enlace. Esta razão captura quão "cheio" um enlace está sendo mantido:

- Se `La/R > 1`: os pacotes estão chegando, em média, mais rápido do que o enlace pode atendê-los. A fila cresce sem limite, e o atraso médio de enfileiramento é efetivamente infinito (na prática, o buffer enche e pacotes são descartados).
- Se `La/R` está perto de 1 mas abaixo dele: a fila ainda pode crescer muito durante rajadas de chegadas, mesmo que a taxa média de longo prazo seja tecnicamente sustentável; o atraso médio de enfileiramento cresce acentuadamente, de forma não linear, à medida que a intensidade de tráfego se aproxima de 1.
- Se `La/R` é pequeno: a fila raramente tem mais do que um ou dois pacotes nela, e o atraso médio de enfileiramento permanece pequeno.

Essa explosão não linear à medida que a intensidade de tráfego se aproxima de 1 é um fenômeno real e importante: uma rede operando a, digamos, 95% da capacidade de um enlace está genuinamente muito pior, em termos de atraso experimentado pelo tráfego real, do que uma operando a 50%, mesmo que ambas estejam "abaixo da capacidade".

### Perda de pacotes

O buffer de saída de um roteador tem capacidade finita. Quando um pacote chega e o buffer já está cheio, o roteador não tem escolha a não ser descartá-lo: perda de pacotes. Isso não é um mau funcionamento; é uma consequência esperada e projetada dos buffers finitos da comutação de pacotes combinados com nenhuma reserva antecipada de capacidade. Um pacote perdido pode ser retransmitido por uma camada superior (como os conceitos posteriores sobre transferência de dados confiável do TCP cobrem em detalhe) ou simplesmente nunca recuperado (como é o caso para muitas aplicações baseadas em UDP), mas a perda em si, na camada de rede, é um evento normal sob carga, não uma anomalia com que se surpreender.

### Vazão

A vazão é a taxa, em bits por segundo, à qual os dados são de fato entregues entre remetente e destinatário. A vazão instantânea é a taxa em um ponto específico no tempo; a vazão média é medida ao longo de uma transferência mais longa. Para um caminho de ponta a ponta cruzando múltiplos enlaces, a vazão alcançável é limitada pelo enlace gargalo, o único enlace mais lento ao longo de todo o caminho, não importa quão rápido seja todo outro enlace no caminho; uma conexão de 1 Gbps em cada extremidade de um caminho que por acaso cruza um enlace de 10 Mbps no meio nunca pode sustentar mais do que cerca de 10 Mbps de ponta a ponta.

## Exemplos Resolvidos

### Exemplo 1: Separando o atraso de transmissão do atraso de propagação

Um pacote de 1.000 bytes (8.000 bits) é enviado por um enlace de 10 Mbps que tem 2.000 km de comprimento, com uma velocidade de propagação de `2 × 10^8` m/s (típica para fibra).

```text
Atraso de transmissão = L / R = 8.000 bits / 10.000.000 bits/seg = 0,8 ms

Atraso de propagação = distância / velocidade
                     = 2.000.000 m / (2 × 10^8 m/s)
                     = 10 ms
```

Aqui o atraso de propagação (10 ms) domina o atraso de transmissão (0,8 ms) por mais de uma ordem de grandeza, uma ilustração direta e numérica de que o comprimento físico de um enlace, não sua velocidade, pode ser o maior contribuinte para o atraso total, especialmente em enlaces de longa distância.

### Exemplo 2: Intensidade de tráfego e explosão do atraso de enfileiramento

Um enlace tem taxa de transmissão `R = 1` Mbps. Comprimento médio do pacote `L = 1.000` bits. Considere três taxas médias de chegada `a` diferentes:

```text
a = 500 pacotes/seg:  La/R = (1.000 × 500) / 1.000.000 = 0,5
a = 900 pacotes/seg:  La/R = (1.000 × 900) / 1.000.000 = 0,9
a = 999 pacotes/seg:  La/R = (1.000 × 999) / 1.000.000 = 0,999
```

Mesmo que todas as três taxas de chegada estejam tecnicamente abaixo da capacidade do enlace (intensidade de tráfego abaixo de 1 em todos os três casos), o atraso médio de enfileiramento é dramaticamente mais alto em 0,999 do que em 0,9, e dramaticamente mais alto em 0,9 do que em 0,5: a relação é acentuadamente não linear, não proporcional. Esta é a versão concreta e numérica de "uma rede rodando perto da capacidade total parece muito mais lenta do que a porcentagem de utilização bruta sozinha sugeriria".

### Exemplo 3: Encontrando o enlace gargalo

Um caminho do host A ao host B cruza três enlaces em sequência:

```text
Enlace 1 (A a roteador R1):  100 Mbps
Enlace 2 (R1 a roteador R2):  10 Mbps
Enlace 3 (R2 a host B):      100 Mbps
```

Mesmo que dois dos três enlaces suportem 100 Mbps, a vazão de ponta a ponta alcançável entre A e B não pode exceder 10 Mbps, a taxa do enlace mais lento, o Enlace 2, que é o gargalo. Nenhuma quantidade de velocidade nos outros dois enlaces pode compensar um enlace genuinamente mais lento em algum ponto do caminho; este é exatamente o raciocínio aplicado mais tarde ao diagnosticar por que uma conexão de outra forma rápida está limitada a alguma taxa inesperadamente baixa.

## Equívocos Comuns e Armadilhas

- **"Um enlace mais rápido sempre significa menor atraso total."** Um enlace mais rápido (`R` maior) reduz o atraso de transmissão, mas o atraso de propagação depende apenas do comprimento físico do enlace e da velocidade do sinal no meio: um enlace mais rápido mas igualmente longo não reduz o atraso de propagação de forma alguma.
- **"Intensidade de tráfego abaixo de 1 significa nenhum atraso significativo."** O atraso médio de enfileiramento cresce acentuadamente, de forma não linear, à medida que a intensidade de tráfego se aproxima de 1 por baixo: "abaixo da capacidade" não é o mesmo que "nenhum atraso", especialmente perto da fronteira.
- **"A perda de pacotes indica uma rede quebrada."** A perda por um buffer cheio sob carga é um resultado esperado e projetado dos buffers finitos da comutação de pacotes e da falta de reserva antecipada: é o que acontece quando a demanda excede a capacidade, por design, não evidência de mau funcionamento.
- **"A vazão é definida pelo enlace mais rápido no caminho."** Ela é limitada pelo enlace mais lento no caminho, o gargalo, independentemente de quão rápido seja todo outro enlace.

## Resumo

Cada salto que um pacote cruza adiciona atraso nodal feito de quatro componentes: processamento (examinar o cabeçalho), enfileiramento (esperar por um enlace de saída ocupado, o mais variável dos quatro), transmissão (`L/R`, o tempo para empurrar os bits do pacote para o enlace) e propagação (o tempo de viagem física de um sinal ao longo do enlace, independente do tamanho do pacote ou da taxa do enlace). A intensidade de tráfego (`La/R`) governa o atraso de enfileiramento, que cresce acentuadamente e de forma não linear à medida que a intensidade se aproxima de 1, significando que um enlace rodando perto de sua capacidade parece muito pior do que o número de utilização bruta sozinho sugeriria. A perda de pacotes, de buffers finitos enchendo sob carga, é uma característica normal e esperada da comutação de pacotes, não uma falha. A vazão de ponta a ponta através de um caminho de múltiplos enlaces é limitada pelo único enlace mais lento, o gargalo, independentemente da velocidade de todo outro enlace. Essas quatro quantidades (atraso, enfileiramento, perda, vazão) são o que todo mecanismo posterior nesta disciplina (a confiabilidade do TCP, sua estimativa de timeout, seu controle de congestionamento) existe especificamente para medir, reagir a, ou contornar.

## Documentation Links

- [Kurose & Ross — Computer Networking: A Top-Down Approach (official companion site)](https://gaia.cs.umass.edu/kurose_ross/index.php): o tratamento do livro-texto padrão sobre atraso nodal, intensidade de tráfego, perda e vazão.
- [ACM/IEEE CS2013 — Networking and Communication Knowledge Area](https://csed.acm.org/knowledge-areas-networking-and-communication-nc-cs2013-version/): diretrizes de currículo listando a análise de atraso, perda e vazão entre as ferramentas quantitativas fundamentais do campo.
