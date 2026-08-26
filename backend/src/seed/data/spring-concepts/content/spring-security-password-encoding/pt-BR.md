---
version: 1.0
updatedAt: 2026-07-31
title: Contrato PasswordEncoder do Spring Security e Estratégias de Encoding
---
## Objective

Um `UserDetailsManager` consegue encontrar um usuário, mas algo ainda precisa
decidir se a senha digitada corresponde à que está armazenada — sem nunca
guardar ou comparar senhas em texto puro. `PasswordEncoder` é o contrato que o
Spring Security usa para essa decisão, e `DelegatingPasswordEncoder` é o que
permite que uma aplicação suporte vários algoritmos de encoding ao mesmo
tempo, em vez de ficar presa a um só para sempre.

## Use Cases

- Armazenar senhas como um hash unidirecional em vez de texto puro, para que
  um vazamento de banco de dados não entregue credenciais utilizáveis.
- Migrar uma aplicação de um algoritmo mais fraco para um mais forte sem um
  reset de senha em massa disruptivo — hashes existentes continuam validando
  sob o algoritmo antigo enquanto novos cadastros recebem o novo.
- Ajustar o custo de um algoritmo de hashing (iterações, memória,
  paralelismo) para equilibrar resistência a força bruta contra latência de
  login aceitável para o seu hardware.

## Deep Dive

### O contrato `PasswordEncoder`

```java
public interface PasswordEncoder {
    String encode(CharSequence rawPassword);
    boolean matches(CharSequence rawPassword, String encodedPassword);
    default boolean upgradeEncoding(String encodedPassword) {
        return false;
    }
}
```

`encode()` produz a forma armazenada de uma senha; `matches()` verifica uma
senha crua submetida contra essa forma armazenada — para um hash de verdade,
`matches()` re-hasheia o input e compara os hashes, nunca reverte o encoding.
`upgradeEncoding()` tem default `false`; sobrescrever para `true` faz a senha
ser re-codificada com as configurações atuais (presumivelmente mais fortes)
na próxima vez que for validada com sucesso.

### Implementações prontas, da mais fraca para a mais forte

- `NoOpPasswordEncoder` — armazena senhas em texto puro. Só é apropriado para
  exemplos descartáveis; nunca para nada real.
- `StandardPasswordEncoder` — baseado em SHA-256, **deprecated**; mantido
  apenas para que aplicações legadas que o usam continuem compilando e
  validando hashes existentes.
- `Pbkdf2PasswordEncoder` — PBKDF2, uma função de derivação de chave lenta;
  uma boa escolha quando certificação FIPS é um requisito.
- `BCryptPasswordEncoder` — bcrypt, ajustável via um parâmetro de
  strength/log-rounds (contagem de iterações = 2^logRounds); o default
  histórico.
- `SCryptPasswordEncoder` — scrypt, uma função memory-hard (custo de CPU,
  custo de memória, paralelização, tamanho de chave, tamanho de salt
  ajustáveis) que resiste melhor a tentativas de cracking com hardware
  customizado (GPU/ASIC) do que bcrypt ou PBKDF2.

```java
PasswordEncoder p1 = new BCryptPasswordEncoder();            // default strength
PasswordEncoder p2 = new BCryptPasswordEncoder(12);           // stronger, slower
PasswordEncoder p3 = new SCryptPasswordEncoder(16384, 8, 1, 32, 64);
// cpuCost, memoryCost, parallelization, keyLength, saltLength
```

### `DelegatingPasswordEncoder`: um encoder, vários algoritmos

Em vez de comprometer todas as senhas do sistema a um único algoritmo para
sempre, `DelegatingPasswordEncoder` prefixa cada hash armazenado com `{id}` e
roteia `matches()` para o encoder correspondente a esse id — assim linhas
diferentes na mesma tabela podem ser hasheadas com algoritmos diferentes:

```java
@Bean
public PasswordEncoder passwordEncoder() {
    Map<String, PasswordEncoder> encoders = new HashMap<>();
    encoders.put("noop", NoOpPasswordEncoder.getInstance());
    encoders.put("bcrypt", new BCryptPasswordEncoder());
    encoders.put("scrypt", new SCryptPasswordEncoder());
    return new DelegatingPasswordEncoder("bcrypt", encoders); // "bcrypt" = default for encode()
}
```

Um hash como `{bcrypt}$2a$10$xn3LI/...` é validado pelo encoder registrado
como `bcrypt`; um hash sem prefixo reconhecido cai de volta para o default
configurado no `DelegatingPasswordEncoder`. Na prática, ninguém constrói esse
mapa manualmente — o Spring Security traz uma factory que pré-registra todas
as implementações padrão com bcrypt como default:

```java
PasswordEncoder passwordEncoder = PasswordEncoderFactories.createDelegatingPasswordEncoder();
```

Esse é o mecanismo que torna uma migração de algoritmo não-disruptiva: aponte
novos encodes para um novo id default, e as linhas existentes continuam
batendo contra qualquer encoder que seu próprio prefixo nomeie — nenhum
rehash em massa é necessário no momento da mudança (só conforme a senha de
cada usuário é tocada em seguida, se `upgradeEncoding` estiver conectado).

## Trade-offs

- **`NoOpPasswordEncoder` e `StandardPasswordEncoder` existem puramente por
  compatibilidade retroativa com código/dados antigos** — a própria
  documentação do Spring Security é explícita que nenhum dos dois deveria
  aparecer numa implementação nova; o SHA-256 do `StandardPasswordEncoder`
  não é mais considerado forte o suficiente sozinho (falta o salt embutido e
  o custo ajustável de bcrypt/scrypt/PBKDF2).
- **bcrypt vs. scrypt vs. PBKDF2 é um trade-off de resistência a hardware,
  não uma escolha de "pegar o mais novo".** A memory-hardness do scrypt
  eleva o custo de cracking com GPU/ASIC mais do que o bcrypt, ao custo de
  ser mais complexo de ajustar corretamente (cinco parâmetros contra o único
  do bcrypt); o PBKDF2 continua sendo a escolha pragmática especificamente
  quando conformidade com FIPS é um requisito obrigatório, independente de
  qual algoritmo é "o melhor".
- **Todo algoritmo adaptativo deveria ser ajustado para custar
  aproximadamente um segundo por verificação no seu próprio hardware** —
  barato demais e o brute-forcing se torna prático; caro demais e a latência
  de login (e a carga do servidor em picos de login) sofre.
- **Livro vs. hoje:** o livro (2020) apresenta bcrypt/scrypt/PBKDF2 como as
  três opções modernas do Spring Security e não enfatiza o
  `Argon2PasswordEncoder` — ele já existia (adicionado no Spring Security
  5.3) mas não era a escolha em destaque na época em que o livro foi
  escrito. A documentação atual do Spring Security agora recomenda o Argon2
  com mais destaque, já que é o algoritmo vencedor da Password Hashing
  Competition; o Spring Security 7.0 introduziu adicionalmente uma família
  paralela de encoders baseados em Password4j
  (`Argon2Password4jPasswordEncoder`, `BcryptPassword4jPasswordEncoder`, e
  outros) como uma implementação alternativa dos mesmos algoritmos.

## Documentation Links

- Laurențiu Spilcă, "Spring Security in Action" (Manning, 2020) — Chapter 4, "Dealing with passwords", section 4.1, "Understanding the PasswordEncoder contract", p. 86-96 — doc
- [Spring Security Reference — Password Storage](https://docs.spring.io/spring-security/reference/features/authentication/password-storage.html) — doc
- [Spring Security API — DelegatingPasswordEncoder](https://docs.spring.io/spring-security/site/docs/current/api/org/springframework/security/crypto/password/DelegatingPasswordEncoder.html) — doc
- [Spring Security API — PasswordEncoderFactories](https://docs.spring.io/spring-security/site/docs/current/api/org/springframework/security/crypto/factory/PasswordEncoderFactories.html) — doc
